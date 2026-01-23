import { Router, type Response } from 'express';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';
import { scheduleCampaignStepMessage, scheduleFirstCampaignMessage } from '../services/crmScheduling';

const router = Router();

function normalizeText(v: any) {
  return String(v || '').trim();
}

router.get('/crm/lead-campaigns', requireAuth, async (req: AuthedRequest, res: Response) => {
  const prisma = getPrisma();
  const limitRaw = Number(req.query?.limit || 200);
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 200));
  const includeArchived = String(req.query?.includeArchived || '') === '1';
  const includeStats = String(req.query?.includeStats || '') === '1';

  const leadCampaigns = await prisma.crmLeadCampaign.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(includeArchived ? {} : { archivedAt: null })
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    include: {
      lead: true,
      campaign: true
    }
  });

  if (includeStats && leadCampaigns.length) {
    const withLastSent = leadCampaigns.filter((lc) => Number((lc as any).lastSentStep || 0) >= 1);
    const leadCampaignIds = withLastSent.map((lc) => lc.id);

    if (leadCampaignIds.length) {
      const rows = await prisma.$queryRawUnsafe<Array<{ messageId: string; leadCampaignId: string }>>(
        `
        SELECT m."id" AS "messageId", m."leadCampaignId" AS "leadCampaignId"
        FROM "CrmEmailMessage" m
        JOIN "CrmLeadCampaign" lc ON lc."id" = m."leadCampaignId"
        WHERE
          lc."organizationId" = $1
          AND m."leadCampaignId" = ANY($2::text[])
          AND m."status" = 'SENT'
          AND m."stepIndex" = lc."lastSentStep"
        `,
        req.auth!.organizationId,
        leadCampaignIds
      );

      const messageByLcId = new Map<string, string>();
      for (const r of rows || []) {
        if (r?.leadCampaignId && r?.messageId) messageByLcId.set(r.leadCampaignId, r.messageId);
      }

      const messageIds = Array.from(messageByLcId.values());
      if (messageIds.length) {
        const aggregates = await prisma.crmEmailEvent.groupBy({
          by: ['messageId', 'type'],
          where: { messageId: { in: messageIds }, type: { in: ['OPENED', 'CLICKED'] } },
          _count: { _all: true },
          _max: { at: true }
        });

        const statsByMessageId = new Map<
          string,
          { opensCount: number; lastOpenedAt: Date | null; clicksCount: number; lastClickedAt: Date | null }
        >();
        for (const a of aggregates) {
          const id = a.messageId;
          const current =
            statsByMessageId.get(id) || ({ opensCount: 0, lastOpenedAt: null, clicksCount: 0, lastClickedAt: null } as any);
          if (a.type === 'OPENED') {
            current.opensCount = Number((a as any)._count?._all || 0);
            current.lastOpenedAt = (a as any)._max?.at || null;
          }
          if (a.type === 'CLICKED') {
            current.clicksCount = Number((a as any)._count?._all || 0);
            current.lastClickedAt = (a as any)._max?.at || null;
          }
          statsByMessageId.set(id, current);
        }

        for (const lc of leadCampaigns) {
          const mid = messageByLcId.get(lc.id);
          if (!mid) continue;
          const s = statsByMessageId.get(mid) || {
            opensCount: 0,
            lastOpenedAt: null,
            clicksCount: 0,
            lastClickedAt: null
          };
          (lc as any).lastMessageStats = {
            messageId: mid,
            stepIndex: Number((lc as any).lastSentStep || 0),
            opensCount: s.opensCount,
            lastOpenedAt: s.lastOpenedAt,
            clicksCount: s.clicksCount,
            lastClickedAt: s.lastClickedAt
          };
        }
      }
    }
  }

  res.json({ leadCampaigns });
});

router.get(
  '/crm/lead-campaigns/:leadCampaignId/messages',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const leadCampaignId = normalizeText(req.params.leadCampaignId);
    if (!leadCampaignId) return res.status(400).json({ error: 'missing_lead_campaign_id' });

    const prisma = getPrisma();
    const lc = await prisma.crmLeadCampaign.findFirst({
      where: { id: leadCampaignId, organizationId: req.auth!.organizationId }
    });
    if (!lc) return res.status(404).json({ error: 'lead_campaign_not_found' });

    const messages = await prisma.crmEmailMessage.findMany({
      where: { leadCampaignId: lc.id },
      orderBy: { stepIndex: 'asc' }
    });

    const messageIds = messages.map((m) => m.id);
    const aggregates = messageIds.length
      ? await prisma.crmEmailEvent.groupBy({
          by: ['messageId', 'type'],
          where: { messageId: { in: messageIds }, type: { in: ['OPENED', 'CLICKED'] } },
          _count: { _all: true },
          _max: { at: true }
        })
      : [];

    const statsByMessageId = new Map<
      string,
      { opensCount: number; lastOpenedAt: Date | null; clicksCount: number; lastClickedAt: Date | null }
    >();
    for (const a of aggregates) {
      const id = a.messageId;
      const current =
        statsByMessageId.get(id) || ({ opensCount: 0, lastOpenedAt: null, clicksCount: 0, lastClickedAt: null } as any);
      if (a.type === 'OPENED') {
        current.opensCount = Number((a as any)._count?._all || 0);
        current.lastOpenedAt = (a as any)._max?.at || null;
      }
      if (a.type === 'CLICKED') {
        current.clicksCount = Number((a as any)._count?._all || 0);
        current.lastClickedAt = (a as any)._max?.at || null;
      }
      statsByMessageId.set(id, current);
    }

    const messagesWithStats = messages.map((m) => {
      const s = statsByMessageId.get(m.id) || { opensCount: 0, lastOpenedAt: null, clicksCount: 0, lastClickedAt: null };
      return {
        ...m,
        opensCount: s.opensCount,
        lastOpenedAt: s.lastOpenedAt,
        clicksCount: s.clicksCount,
        lastClickedAt: s.lastClickedAt
      };
    });

    res.json({ messages: messagesWithStats });
  }
);

router.post(
  '/crm/leads/:leadId/start-campaign',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const leadId = normalizeText(req.params.leadId);
    const campaignId = normalizeText(req.body?.campaignId);
    if (!leadId) return res.status(400).json({ error: 'missing_lead_id' });
    if (!campaignId) return res.status(400).json({ error: 'missing_campaign_id' });

    const prisma = getPrisma();

    const lead = await prisma.crmLead.findFirst({
      where: { id: leadId, organizationId: req.auth!.organizationId }
    });
    if (!lead) return res.status(404).json({ error: 'lead_not_found' });

    const campaign = await prisma.crmCampaign.findFirst({
      where: { id: campaignId, organizationId: req.auth!.organizationId },
      include: { emails: { orderBy: { stepIndex: 'asc' } } }
    });
    if (!campaign) return res.status(404).json({ error: 'campaign_not_found' });
    if (campaign.status !== 'READY') return res.status(400).json({ error: 'campaign_not_ready' });
    if (!campaign.emails.length) return res.status(400).json({ error: 'campaign_has_no_emails' });

    const existingActive = await prisma.crmLeadCampaign.findFirst({
      where: { organizationId: req.auth!.organizationId, leadId: lead.id, archivedAt: null }
    });
    if (existingActive) return res.status(409).json({ error: 'lead_campaign_already_active' });

    const created = await prisma.$transaction(async (tx) => {
      // re-activate lead if it was out-of-pipe
      if (lead.archivedAt) {
        await tx.crmLead.update({ where: { id: lead.id }, data: { archivedAt: null, archiveReason: null } });
      }

      const lc = await tx.crmLeadCampaign.create({
        data: {
          organizationId: req.auth!.organizationId,
          leadId: lead.id,
          campaignId: campaign.id,
          lastSentStep: 0,
          awaitingValidation: false,
          archivedAt: null,
          archiveReason: null,
          nextSendAt: null
        }
      });

      await scheduleFirstCampaignMessage(tx, lc.id);

      return tx.crmLeadCampaign.findFirst({
        where: { id: lc.id },
        include: { lead: true, campaign: true }
      });
    });

    res.status(201).json({ leadCampaign: created });
  }
);

router.post(
  '/crm/lead-campaigns/:leadCampaignId/validation',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const leadCampaignId = normalizeText(req.params.leadCampaignId);
    if (!leadCampaignId) return res.status(400).json({ error: 'missing_lead_campaign_id' });

    const result = normalizeText(req.body?.result).toUpperCase();
    if (result !== 'NO_REPLY' && result !== 'REPLIED') return res.status(400).json({ error: 'invalid_result' });

    const prisma = getPrisma();
    const lc = await prisma.crmLeadCampaign.findFirst({
      where: { id: leadCampaignId, organizationId: req.auth!.organizationId },
      include: { campaign: { include: { emails: { orderBy: { stepIndex: 'asc' } } } }, lead: true }
    });
    if (!lc) return res.status(404).json({ error: 'lead_campaign_not_found' });
    if (lc.archivedAt) return res.status(400).json({ error: 'lead_campaign_archived' });
    if (!lc.awaitingValidation) return res.status(400).json({ error: 'not_waiting_validation' });

    const stepsCount = lc.campaign.emails.length;
    if (!stepsCount) return res.status(400).json({ error: 'campaign_has_no_emails' });

    if (result === 'REPLIED') {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.crmLead.update({
          where: { id: lc.leadId },
          data: { archivedAt: new Date(), archiveReason: 'REPLIED_MANUAL' }
        });
        const updatedLc = await tx.crmLeadCampaign.update({
          where: { id: lc.id },
          data: { archivedAt: new Date(), archiveReason: 'REPLIED_MANUAL', awaitingValidation: false, nextSendAt: null }
        });
        // cancel any future scheduled messages
        await tx.crmEmailMessage.updateMany({
          where: { leadCampaignId: lc.id, status: { in: ['SCHEDULED', 'SENDING'] } },
          data: { status: 'CANCELED' }
        });
        return updatedLc;
      });

      return res.json({ leadCampaign: updated });
    }

    // NO_REPLY
    if (lc.lastSentStep >= stepsCount) {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.crmLead.update({
          where: { id: lc.leadId },
          data: { archivedAt: new Date(), archiveReason: 'NO_RESPONSE_END' }
        });
        return tx.crmLeadCampaign.update({
          where: { id: lc.id },
          data: { archivedAt: new Date(), archiveReason: 'NO_RESPONSE_END', awaitingValidation: false, nextSendAt: null }
        });
      });
      return res.json({ leadCampaign: updated });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.crmLeadCampaign.update({
        where: { id: lc.id },
        data: { awaitingValidation: false }
      });

      await scheduleCampaignStepMessage(tx, lc.id, lc.lastSentStep + 1);

      return tx.crmLeadCampaign.findFirst({
        where: { id: lc.id },
        include: { lead: true, campaign: true }
      });
    });

    res.json({ leadCampaign: updated });
  }
);

router.post(
  '/crm/lead-campaigns/:leadCampaignId/archive',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const leadCampaignId = normalizeText(req.params.leadCampaignId);
    if (!leadCampaignId) return res.status(400).json({ error: 'missing_lead_campaign_id' });

    const prisma = getPrisma();
    const lc = await prisma.crmLeadCampaign.findFirst({
      where: { id: leadCampaignId, organizationId: req.auth!.organizationId }
    });
    if (!lc) return res.status(404).json({ error: 'lead_campaign_not_found' });

    const reasonRaw = normalizeText(req.body?.reason).toUpperCase();
    const reason = reasonRaw === 'REPLIED_MANUAL' ? 'REPLIED_MANUAL' : 'MANUAL_TAKEOVER';

    const updated = await prisma.$transaction(async (tx) => {
      await tx.crmEmailMessage.updateMany({
        where: { leadCampaignId: lc.id, status: { in: ['SCHEDULED', 'SENDING'] } },
        data: { status: 'CANCELED' }
      });
      await tx.crmLead.update({
        where: { id: lc.leadId },
        data: { archivedAt: new Date(), archiveReason: reason as any }
      });
      return tx.crmLeadCampaign.update({
        where: { id: lc.id },
        data: { archivedAt: new Date(), archiveReason: reason as any, awaitingValidation: false, nextSendAt: null }
      });
    });

    res.json({ leadCampaign: updated });
  }
);

router.post(
  '/crm/lead-campaigns/:leadCampaignId/mark-awaiting-validation',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const leadCampaignId = normalizeText(req.params.leadCampaignId);
    if (!leadCampaignId) return res.status(400).json({ error: 'missing_lead_campaign_id' });

    const prisma = getPrisma();
    const lc = await prisma.crmLeadCampaign.findFirst({
      where: { id: leadCampaignId, organizationId: req.auth!.organizationId }
    });
    if (!lc) return res.status(404).json({ error: 'lead_campaign_not_found' });
    if (lc.archivedAt) return res.status(400).json({ error: 'lead_campaign_archived' });

    const updated = await prisma.crmLeadCampaign.update({
      where: { id: lc.id },
      data: { awaitingValidation: true, nextSendAt: null }
    });
    res.json({ leadCampaign: updated });
  }
);

export default router;
