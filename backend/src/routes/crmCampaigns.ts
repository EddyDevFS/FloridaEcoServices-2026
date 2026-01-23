import { Router, type Response } from 'express';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';

const router = Router();

function normalizeText(v: any) {
  return String(v || '').trim();
}

function clampInt(v: any, min: number, max: number, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function isValidTimeHHMM(v: any) {
  return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) && v >= '00:00' && v <= '23:59';
}

router.get('/crm/campaigns', requireAuth, async (req: AuthedRequest, res: Response) => {
  const prisma = getPrisma();
  const limitRaw = Number(req.query?.limit || 200);
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 200));

  const campaigns = await prisma.crmCampaign.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    include: { emails: { orderBy: { stepIndex: 'asc' } } }
  });

  res.json({ campaigns });
});

router.get('/crm/campaigns/:campaignId', requireAuth, async (req: AuthedRequest, res: Response) => {
  const campaignId = normalizeText(req.params.campaignId);
  if (!campaignId) return res.status(400).json({ error: 'missing_campaign_id' });

  const prisma = getPrisma();
  const campaign = await prisma.crmCampaign.findFirst({
    where: { id: campaignId, organizationId: req.auth!.organizationId },
    include: { emails: { orderBy: { stepIndex: 'asc' } } }
  });
  if (!campaign) return res.status(404).json({ error: 'campaign_not_found' });
  res.json({ campaign });
});

router.post(
  '/crm/campaigns',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const prisma = getPrisma();
    const name = normalizeText(req.body?.name);
    const stepsCount = clampInt(req.body?.stepsCount, 1, 10, 4);
    const timezone = normalizeText(req.body?.timezone) || 'America/New_York';

    if (!name) return res.status(400).json({ error: 'missing_campaign_name' });

    const campaign = await prisma.$transaction(async (tx) => {
      const created = await tx.crmCampaign.create({
        data: {
          organizationId: req.auth!.organizationId,
          name,
          timezone,
          status: 'DRAFT'
        }
      });

      for (let i = 1; i <= stepsCount; i++) {
        await tx.crmCampaignEmail.create({
          data: {
            campaignId: created.id,
            stepIndex: i,
            sendTime: '09:00',
            delayDaysAfter: i === stepsCount ? 0 : 2,
            subjectTemplate: '',
            bodyTemplate: ''
          }
        });
      }
      return tx.crmCampaign.findFirst({
        where: { id: created.id },
        include: { emails: { orderBy: { stepIndex: 'asc' } } }
      });
    });

    res.status(201).json({ campaign });
  }
);

router.patch(
  '/crm/campaigns/:campaignId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const campaignId = normalizeText(req.params.campaignId);
    if (!campaignId) return res.status(400).json({ error: 'missing_campaign_id' });

    const prisma = getPrisma();
    const campaign = await prisma.crmCampaign.findFirst({
      where: { id: campaignId, organizationId: req.auth!.organizationId }
    });
    if (!campaign) return res.status(404).json({ error: 'campaign_not_found' });

    const data: any = {};
    if (req.body?.name !== undefined) data.name = normalizeText(req.body?.name);
    if (req.body?.timezone !== undefined) data.timezone = normalizeText(req.body?.timezone) || 'America/New_York';
    if (req.body?.status !== undefined) {
      // only allow reverting to DRAFT via API; publish uses dedicated endpoint.
      const s = normalizeText(req.body?.status).toUpperCase();
      if (s === 'DRAFT') data.status = 'DRAFT';
    }

    if (data.name !== undefined && !data.name) return res.status(400).json({ error: 'missing_campaign_name' });

    const updated = await prisma.crmCampaign.update({
      where: { id: campaign.id },
      data
    });

    res.json({ campaign: updated });
  }
);

router.patch(
  '/crm/campaigns/:campaignId/emails/:stepIndex',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const campaignId = normalizeText(req.params.campaignId);
    const stepIndex = clampInt(req.params.stepIndex, 1, 999, 0);
    if (!campaignId || !stepIndex) return res.status(400).json({ error: 'missing_campaign_or_step' });

    const prisma = getPrisma();
    const campaign = await prisma.crmCampaign.findFirst({
      where: { id: campaignId, organizationId: req.auth!.organizationId },
      include: { emails: { orderBy: { stepIndex: 'asc' } } }
    });
    if (!campaign) return res.status(404).json({ error: 'campaign_not_found' });

    const email = campaign.emails.find((e) => e.stepIndex === stepIndex);
    if (!email) return res.status(404).json({ error: 'campaign_email_not_found' });

    const data: any = {};
    if (req.body?.sendTime !== undefined) {
      const t = normalizeText(req.body?.sendTime);
      if (!isValidTimeHHMM(t)) return res.status(400).json({ error: 'invalid_send_time' });
      data.sendTime = t;
    }
    if (req.body?.delayDaysAfter !== undefined) {
      const isLast = stepIndex === campaign.emails.length;
      if (isLast) {
        data.delayDaysAfter = 0;
      } else {
        data.delayDaysAfter = clampInt(req.body?.delayDaysAfter, 1, 30, 2);
      }
    }
    if (req.body?.subjectTemplate !== undefined) data.subjectTemplate = normalizeText(req.body?.subjectTemplate);
    if (req.body?.bodyTemplate !== undefined) data.bodyTemplate = String(req.body?.bodyTemplate || '');

    const updatedEmail = await prisma.crmCampaignEmail.update({
      where: { id: email.id },
      data
    });

    // Editing a campaign always puts it back in DRAFT; publish again to go READY.
    if (campaign.status === 'READY') {
      await prisma.crmCampaign.update({ where: { id: campaign.id }, data: { status: 'DRAFT' } });
    }

    res.json({ email: updatedEmail });
  }
);

router.post(
  '/crm/campaigns/:campaignId/publish',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const campaignId = normalizeText(req.params.campaignId);
    if (!campaignId) return res.status(400).json({ error: 'missing_campaign_id' });

    const prisma = getPrisma();
    const campaign = await prisma.crmCampaign.findFirst({
      where: { id: campaignId, organizationId: req.auth!.organizationId },
      include: { emails: { orderBy: { stepIndex: 'asc' } } }
    });
    if (!campaign) return res.status(404).json({ error: 'campaign_not_found' });

    if (campaign.emails.length === 0) return res.status(400).json({ error: 'campaign_has_no_emails' });

    const missing: string[] = [];
    for (const e of campaign.emails) {
      const isLast = e.stepIndex === campaign.emails.length;
      if (!normalizeText(e.subjectTemplate)) missing.push(`email_${e.stepIndex}_subject`);
      if (!normalizeText(e.bodyTemplate)) missing.push(`email_${e.stepIndex}_body`);
      if (!isValidTimeHHMM(e.sendTime)) missing.push(`email_${e.stepIndex}_sendTime`);
      if (!isLast && !(e.delayDaysAfter >= 1)) missing.push(`email_${e.stepIndex}_delayDaysAfter`);
    }
    if (missing.length) return res.status(400).json({ error: 'campaign_incomplete', missing });

    const updated = await prisma.crmCampaign.update({
      where: { id: campaign.id },
      data: { status: 'READY' }
    });

    res.json({ campaign: updated });
  }
);

export default router;

