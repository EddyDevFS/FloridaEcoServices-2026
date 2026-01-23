import { Router, type Response } from 'express';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';

const router = Router();

function normalizeText(v: any) {
  return String(v || '').trim();
}

function normalizeEmail(v: any) {
  return normalizeText(v).toLowerCase();
}

router.get('/crm/leads', requireAuth, async (req: AuthedRequest, res: Response) => {
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
});

router.get('/crm/leads/:leadId', requireAuth, async (req: AuthedRequest, res: Response) => {
  const leadId = normalizeText(req.params.leadId);
  if (!leadId) return res.status(400).json({ error: 'missing_lead_id' });

  const prisma = getPrisma();
  const lead = await prisma.crmLead.findFirst({
    where: { id: leadId, organizationId: req.auth!.organizationId }
  });
  if (!lead) return res.status(404).json({ error: 'lead_not_found' });
  res.json({ lead });
});

router.post('/crm/leads', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
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
});

router.patch(
  '/crm/leads/:leadId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
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
  }
);

router.post(
  '/crm/leads/:leadId/archive',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
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
  }
);

router.post(
  '/crm/leads/:leadId/restore',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
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
  }
);

router.delete(
  '/crm/leads/:leadId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const leadId = normalizeText(req.params.leadId);
    if (!leadId) return res.status(400).json({ error: 'missing_lead_id' });

    const prisma = getPrisma();
    const lead = await prisma.crmLead.findFirst({
      where: { id: leadId, organizationId: req.auth!.organizationId }
    });
    if (!lead) return res.status(404).json({ error: 'lead_not_found' });

    await prisma.crmLead.delete({ where: { id: lead.id } });
    res.json({ ok: true });
  }
);

export default router;

