import { Router, type Response } from 'express';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';
import { scheduleCampaignStepMessage } from '../services/crmScheduling';
import { sendMail } from '../email/mailer';

const router = Router();

const asyncHandler =
  (fn: any) =>
  (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

function normalizeText(v: any) {
  return String(v || '').trim();
}

function normalizeEmail(v: any) {
  return normalizeText(v).toLowerCase();
}

function buildReplyToForLeadCampaign(leadCampaignId: string) {
  const smtpUser = normalizeText(process.env.SMTP_USER);
  if (!smtpUser || !smtpUser.includes('@')) return null;
  const [local, domain] = smtpUser.split('@');
  if (!local || !domain) return null;
  return `${local}+lc_${leadCampaignId}@${domain}`;
}

router.get(
  '/crm/leads',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
  const prisma = getPrisma();
  const limitRaw = Number(req.query?.limit || 200);
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 200));
  const includeArchived = String(req.query?.includeArchived || '') === '1';
  const q = normalizeText(req.query?.q || '').toLowerCase();

  const leads = await prisma.crmLead.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(includeArchived ? {} : { archivedAt: null }),
      ...(q
        ? {
            OR: [
              { hotelName: { contains: q, mode: 'insensitive' } },
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { email1: { contains: q, mode: 'insensitive' } },
              { email2: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q, mode: 'insensitive' } },
              { notes: { contains: q, mode: 'insensitive' } }
            ]
          }
        : {})
    },
    orderBy: { updatedAt: 'desc' },
    take: limit
  });

  res.json({ leads });
  })
);

router.get(
  '/crm/leads/:leadId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
  const leadId = normalizeText(req.params.leadId);
  if (!leadId) return res.status(400).json({ error: 'missing_lead_id' });

  const prisma = getPrisma();
  const lead = await prisma.crmLead.findFirst({
    where: { id: leadId, organizationId: req.auth!.organizationId }
  });
  if (!lead) return res.status(404).json({ error: 'lead_not_found' });
  res.json({ lead });
  })
);

router.post(
  '/crm/leads',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
  const prisma = getPrisma();
  const hotelName = normalizeText(req.body?.hotelName);
  const firstName = normalizeText(req.body?.firstName);
  const lastName = normalizeText(req.body?.lastName);
  const email1 = normalizeEmail(req.body?.email1);
  const email2 = normalizeEmail(req.body?.email2);
  const phone = normalizeText(req.body?.phone);
  const notes = normalizeText(req.body?.notes);

  if (!hotelName) return res.status(400).json({ error: 'missing_hotel_name' });
  if (!email1) return res.status(400).json({ error: 'missing_email1' });

  const lead = await prisma.crmLead.create({
    data: {
      organizationId: req.auth!.organizationId,
      hotelName,
      firstName,
      lastName,
      email1,
      email2,
      phone,
      notes
    }
  });

  res.status(201).json({ lead });
  })
);

router.post(
  '/crm/leads/:leadId/send-email',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const prisma = getPrisma();

    const leadId = normalizeText(req.params.leadId);
    if (!leadId) return res.status(400).json({ error: 'missing_lead_id' });

    const lead = await prisma.crmLead.findFirst({
      where: { id: leadId, organizationId: req.auth!.organizationId }
    });
    if (!lead) return res.status(404).json({ error: 'lead_not_found' });

    const toEmail = normalizeEmail(req.body?.toEmail || lead.email1);
    const subject = normalizeText(req.body?.subject);
    const text = normalizeText(req.body?.text);

    if (!toEmail) return res.status(400).json({ error: 'missing_to_email' });
    if (!subject) return res.status(400).json({ error: 'missing_subject' });
    if (!text) return res.status(400).json({ error: 'missing_text' });

    const lc = await prisma.crmLeadCampaign.findFirst({
      where: { organizationId: req.auth!.organizationId, leadId, archivedAt: null },
      select: { id: true }
    });

    const replyTo = lc?.id ? buildReplyToForLeadCampaign(String(lc.id)) : null;

    try {
      const info = await sendMail({
        to: [toEmail],
        subject,
        text,
        replyTo: replyTo || undefined,
        headers: {
          ...(lc?.id ? { 'X-Crm-Lead-Campaign-Id': String(lc.id) } : {}),
          'X-Crm-Lead-Id': String(lead.id)
        }
      });

      const providerMessageId = normalizeText((info as any)?.messageId || '') || null;
      res.json({ ok: true, provider: 'smtp', providerMessageId });
    } catch (err: any) {
      console.error('[crm] send-email failed', err);
      const message = normalizeText(err?.message || '');
      if (message === 'smtp_not_configured') return res.status(400).json({ error: 'smtp_not_configured' });
      const code = normalizeText(err?.code || err?.responseCode || '');
      return res.status(502).json({ error: 'smtp_send_failed', ...(code ? { code } : {}) });
    }
  })
);

router.post(
  '/crm/leads/:leadId/trigger-next-email',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const prisma = getPrisma();
    const leadId = normalizeText(req.params.leadId);
    if (!leadId) return res.status(400).json({ error: 'missing_lead_id' });

    const lead = await prisma.crmLead.findFirst({
      where: { id: leadId, organizationId: req.auth!.organizationId },
      select: { id: true }
    });
    if (!lead) return res.status(404).json({ error: 'lead_not_found' });

    const lc = await prisma.crmLeadCampaign.findFirst({
      where: { organizationId: req.auth!.organizationId, leadId, archivedAt: null },
      include: { campaign: { include: { emails: { orderBy: { stepIndex: 'asc' } } } } }
    });
    if (!lc) return res.status(400).json({ error: 'no_active_lead_campaign' });
    if (lc.campaign.status !== 'READY') return res.status(400).json({ error: 'campaign_not_ready' });

    const stepsCount = lc.campaign.emails.length;
    if (!stepsCount) return res.status(400).json({ error: 'campaign_has_no_emails' });

    const nextStepIndex = Math.max(1, Number(lc.lastSentStep || 0) + 1);
    if (nextStepIndex > stepsCount) return res.status(400).json({ error: 'no_next_step' });

    const now = new Date();
    const updatedMsg = await prisma.$transaction(async (tx) => {
      if (lc.awaitingValidation) {
        await tx.crmLeadCampaign.update({
          where: { id: lc.id },
          data: { awaitingValidation: false }
        });
      }

      const msg = await scheduleCampaignStepMessage(tx, lc.id, nextStepIndex);

      const patched = await tx.crmEmailMessage.update({
        where: { id: msg.id },
        data: { sendAt: now, status: 'SCHEDULED' }
      });

      await tx.crmLeadCampaign.update({
        where: { id: lc.id },
        data: { nextSendAt: now }
      });

      return patched;
    });

    res.json({ ok: true, messageId: updatedMsg.id, stepIndex: nextStepIndex, sendAt: updatedMsg.sendAt });
  })
);

router.patch(
  '/crm/leads/:leadId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const leadId = normalizeText(req.params.leadId);
    if (!leadId) return res.status(400).json({ error: 'missing_lead_id' });

    const prisma = getPrisma();
    const existing = await prisma.crmLead.findFirst({
      where: { id: leadId, organizationId: req.auth!.organizationId }
    });
    if (!existing) return res.status(404).json({ error: 'lead_not_found' });

    const data: any = {};
    if (req.body?.hotelName !== undefined) data.hotelName = normalizeText(req.body?.hotelName);
    if (req.body?.firstName !== undefined) data.firstName = normalizeText(req.body?.firstName);
    if (req.body?.lastName !== undefined) data.lastName = normalizeText(req.body?.lastName);
    if (req.body?.email1 !== undefined) data.email1 = normalizeEmail(req.body?.email1);
    if (req.body?.email2 !== undefined) data.email2 = normalizeEmail(req.body?.email2);
    if (req.body?.phone !== undefined) data.phone = normalizeText(req.body?.phone);
    if (req.body?.notes !== undefined) data.notes = normalizeText(req.body?.notes);

    if (data.hotelName !== undefined && !data.hotelName) return res.status(400).json({ error: 'missing_hotel_name' });
    if (data.email1 !== undefined && !data.email1) return res.status(400).json({ error: 'missing_email1' });

    const lead = await prisma.crmLead.update({
      where: { id: existing.id },
      data
    });

    res.json({ lead });
  })
);

router.post(
  '/crm/leads/:leadId/archive',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const leadId = normalizeText(req.params.leadId);
    if (!leadId) return res.status(400).json({ error: 'missing_lead_id' });

    const prisma = getPrisma();
    const lead = await prisma.crmLead.findFirst({
      where: { id: leadId, organizationId: req.auth!.organizationId }
    });
    if (!lead) return res.status(404).json({ error: 'lead_not_found' });

    const updated = await prisma.crmLead.update({
      where: { id: lead.id },
      data: {
        archivedAt: new Date(),
        archiveReason: 'MANUAL_TAKEOVER'
      }
    });
    res.json({ lead: updated });
  })
);

router.post(
  '/crm/leads/:leadId/restore',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const leadId = normalizeText(req.params.leadId);
    if (!leadId) return res.status(400).json({ error: 'missing_lead_id' });

    const prisma = getPrisma();
    const lead = await prisma.crmLead.findFirst({
      where: { id: leadId, organizationId: req.auth!.organizationId }
    });
    if (!lead) return res.status(404).json({ error: 'lead_not_found' });

    const updated = await prisma.crmLead.update({
      where: { id: lead.id },
      data: {
        archivedAt: null,
        archiveReason: null
      }
    });
    res.json({ lead: updated });
  })
);

router.delete(
  '/crm/leads/:leadId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const leadId = normalizeText(req.params.leadId);
    if (!leadId) return res.status(400).json({ error: 'missing_lead_id' });

    const prisma = getPrisma();
    const lead = await prisma.crmLead.findFirst({
      where: { id: leadId, organizationId: req.auth!.organizationId }
    });
    if (!lead) return res.status(404).json({ error: 'lead_not_found' });

    await prisma.crmLead.delete({ where: { id: lead.id } });
    res.json({ ok: true });
  })
);

export default router;
