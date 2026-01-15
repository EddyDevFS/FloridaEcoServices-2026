import { Router, type Response } from 'express';
import { randomBytes } from 'crypto';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';
import { requireHotelScope } from '../auth/scope';
import { sendMail } from '../email/mailer';

const router = Router();

function makeContractToken(): string {
  return `ctok_${randomBytes(12).toString('hex')}`;
}

function normalizeSurfaceType(v: any): 'BOTH' | 'CARPET' | 'TILE' {
  const s = String(v || '').trim().toUpperCase();
  if (s === 'CARPET' || s === 'TILE' || s === 'BOTH') return s;
  return 'BOTH';
}

function normalizeContractFrequency(v: any): 'YEARLY' | 'TWICE_YEAR' {
  const s = String(v || '').trim().toUpperCase();
  if (s === 'TWICE_YEAR') return 'TWICE_YEAR';
  return 'YEARLY';
}

function normalizeContractStatus(v: any): 'SENT' | 'ACCEPTED' {
  const s = String(v || '').trim().toUpperCase();
  if (s === 'ACCEPTED') return 'ACCEPTED';
  return 'SENT';
}

function defaultPricing() {
  return {
    roomsMinPerSession: 10,
    roomsMaxPerSession: 20,
    basePrices: { BOTH: 65, CARPET: 45, TILE: 40 },
    penaltyPrices: { BOTH: 75, CARPET: 55, TILE: 50 },
    contractPrices: { BOTH: 65, CARPET: 45, TILE: 40 },
    advantagePrices: { BOTH: 60, CARPET: 42, TILE: 38 },
    sqftPrices: { CARPET: 0, TILE: 0 }
  };
}

async function getOrCreatePricingDefaults(prisma: ReturnType<typeof getPrisma>, organizationId: string) {
  const existing = await prisma.pricingDefaults.findUnique({ where: { organizationId } });
  if (existing) return existing;
  const d = defaultPricing();
  return prisma.pricingDefaults.create({
    data: {
      organizationId,
      roomsMinPerSession: d.roomsMinPerSession,
      roomsMaxPerSession: d.roomsMaxPerSession,
      basePrices: d.basePrices,
      penaltyPrices: d.penaltyPrices,
      contractPrices: d.contractPrices,
      advantagePrices: d.advantagePrices,
      sqftPrices: d.sqftPrices
    }
  });
}

// ===== PRICING DEFAULTS (org) =====

router.get('/pricing/defaults', requireAuth, async (req: AuthedRequest, res: Response) => {
  const prisma = getPrisma();
  const defaults = await getOrCreatePricingDefaults(prisma, req.auth!.organizationId);
  res.json({ defaults });
});

router.patch(
  '/pricing/defaults',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const prisma = getPrisma();
    const current = await getOrCreatePricingDefaults(prisma, req.auth!.organizationId);

    const patch: any = {};
    if (req.body?.roomsMinPerSession !== undefined) patch.roomsMinPerSession = Number(req.body.roomsMinPerSession) || 0;
    if (req.body?.roomsMaxPerSession !== undefined) patch.roomsMaxPerSession = Number(req.body.roomsMaxPerSession) || 0;

    const mergeJson = (currentVal: any, nextVal: any) => {
      if (!nextVal || typeof nextVal !== 'object') return currentVal;
      return { ...(currentVal || {}), ...(nextVal || {}) };
    };

    if (req.body?.basePrices !== undefined) patch.basePrices = mergeJson(current.basePrices, req.body.basePrices);
    if (req.body?.penaltyPrices !== undefined) patch.penaltyPrices = mergeJson(current.penaltyPrices, req.body.penaltyPrices);
    if (req.body?.contractPrices !== undefined) patch.contractPrices = mergeJson(current.contractPrices, req.body.contractPrices);
    if (req.body?.advantagePrices !== undefined) patch.advantagePrices = mergeJson(current.advantagePrices, req.body.advantagePrices);
    if (req.body?.sqftPrices !== undefined) patch.sqftPrices = mergeJson(current.sqftPrices, req.body.sqftPrices);

    const updated = await prisma.pricingDefaults.update({
      where: { organizationId: req.auth!.organizationId },
      data: patch
    });
    res.json({ defaults: updated });
  }
);

// ===== CONTRACTS (auth) =====

router.get('/hotels/:hotelId/contracts', requireAuth, async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.params.hotelId || '').trim();
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (!requireHotelScope(req, res, hotelId)) return;

  const prisma = getPrisma();
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!hotel) return res.status(404).json({ error: 'hotel_not_found' });

  const contracts = await prisma.contract.findMany({
    where: { hotelId, organizationId: req.auth!.organizationId },
    orderBy: { sentAt: 'desc' }
  });
  res.json({ contracts });
});

router.post(
  '/hotels/:hotelId/contracts',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const hotelId = String(req.params.hotelId || '').trim();
    if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
    if (!requireHotelScope(req, res, hotelId)) return;

    const prisma = getPrisma();
    const hotel = await prisma.hotel.findFirst({
      where: { id: hotelId, organizationId: req.auth!.organizationId },
      select: { id: true, name: true }
    });
    if (!hotel) return res.status(404).json({ error: 'hotel_not_found' });

    const sentAt = req.body?.sentAt ? new Date(String(req.body.sentAt)) : new Date();
    const safeSentAt = Number.isFinite(sentAt.getTime()) ? sentAt : new Date();

    const contract = await prisma.contract.create({
      data: {
        organizationId: req.auth!.organizationId,
        hotelId,
        token: makeContractToken(),
        status: 'SENT',
        hotelName: String(req.body?.hotelName || hotel.name || ''),
        contact: req.body?.contact ?? {},
        pricing: req.body?.pricing ?? {},
        roomsMinPerSession: Number(req.body?.roomsMinPerSession) || 0,
        roomsMaxPerSession: Number(req.body?.roomsMaxPerSession) || 0,
        roomsPerSession: Number(req.body?.roomsPerSession) || 0,
        frequency: normalizeContractFrequency(req.body?.frequency),
        surfaceType: normalizeSurfaceType(req.body?.surfaceType),
        appliedTier: String(req.body?.appliedTier || ''),
        appliedPricePerRoom: Number(req.body?.appliedPricePerRoom) || 0,
        otherSurfaces: req.body?.otherSurfaces ?? {},
        totalPerSession: Number(req.body?.totalPerSession) || 0,
        notes: String(req.body?.notes || ''),
        sentAt: safeSentAt
      }
    });

    res.status(201).json({ contract });
  }
);

router.patch(
  '/contracts/:contractId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const contractId = String(req.params.contractId || '').trim();
    if (!contractId) return res.status(400).json({ error: 'missing_contract_id' });

    const prisma = getPrisma();
    const existing = await prisma.contract.findFirst({
      where: { id: contractId, organizationId: req.auth!.organizationId }
    });
    if (!existing) return res.status(404).json({ error: 'contract_not_found' });

    const patch: any = {};
    if (req.body?.status !== undefined) patch.status = normalizeContractStatus(req.body.status);
    if (req.body?.hotelName !== undefined) patch.hotelName = String(req.body.hotelName || '');
    if (req.body?.contact !== undefined) patch.contact = req.body.contact ?? {};
    if (req.body?.pricing !== undefined) patch.pricing = req.body.pricing ?? {};
    if (req.body?.roomsMinPerSession !== undefined) patch.roomsMinPerSession = Number(req.body.roomsMinPerSession) || 0;
    if (req.body?.roomsMaxPerSession !== undefined) patch.roomsMaxPerSession = Number(req.body.roomsMaxPerSession) || 0;
    if (req.body?.roomsPerSession !== undefined) patch.roomsPerSession = Number(req.body.roomsPerSession) || 0;
    if (req.body?.frequency !== undefined) patch.frequency = normalizeContractFrequency(req.body.frequency);
    if (req.body?.surfaceType !== undefined) patch.surfaceType = normalizeSurfaceType(req.body.surfaceType);
    if (req.body?.appliedTier !== undefined) patch.appliedTier = String(req.body.appliedTier || '');
    if (req.body?.appliedPricePerRoom !== undefined) patch.appliedPricePerRoom = Number(req.body.appliedPricePerRoom) || 0;
    if (req.body?.otherSurfaces !== undefined) patch.otherSurfaces = req.body.otherSurfaces ?? {};
    if (req.body?.totalPerSession !== undefined) patch.totalPerSession = Number(req.body.totalPerSession) || 0;
    if (req.body?.notes !== undefined) patch.notes = String(req.body.notes || '');

    const updated = await prisma.contract.update({ where: { id: contractId }, data: patch });
    res.json({ contract: updated });
  }
);

router.delete(
  '/contracts/:contractId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const contractId = String(req.params.contractId || '').trim();
    if (!contractId) return res.status(400).json({ error: 'missing_contract_id' });

    const prisma = getPrisma();
    const existing = await prisma.contract.findFirst({
      where: { id: contractId, organizationId: req.auth!.organizationId },
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ error: 'contract_not_found' });

    await prisma.contract.delete({ where: { id: contractId } });
    res.json({ ok: true });
  }
);

router.post(
  '/contracts/:contractId/send',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const contractId = String(req.params.contractId || '').trim();
    if (!contractId) return res.status(400).json({ error: 'missing_contract_id' });

    const prisma = getPrisma();
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, organizationId: req.auth!.organizationId }
    });
    if (!contract) return res.status(404).json({ error: 'contract_not_found' });
    if (!requireHotelScope(req, res, contract.hotelId)) return;

    const contact: any = contract.contact || {};
    const to = String(contact?.email || '').trim();
    if (!to) return res.status(400).json({ error: 'missing_contact_email' });

    const cc = Array.isArray(contact?.cc) ? contact.cc.map((v: any) => String(v || '').trim()).filter(Boolean) : [];
    const appUrl = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
    const link = `${appUrl || 'https://app.floridaecoservices.com'}/contract_view.html?token=${encodeURIComponent(contract.token)}`;

    const subject = `Florida Eco Services — Contract for ${contract.hotelName || 'your hotel'}`;
    const text = `Hello,\n\nPlease review and sign your contract using this secure link:\n\n${link}\n\nThank you,\nFlorida Eco Services`;
    const html =
      `<p>Hello,</p>` +
      `<p>Please review and sign your contract using this secure link:</p>` +
      `<p><a href="${link}">${link}</a></p>` +
      `<p>Thank you,<br>Florida Eco Services</p>`;

    try {
      const info = await sendMail({
        to: [to],
        cc,
        subject,
        text,
        html
      });
      res.json({ ok: true, messageId: (info as any)?.messageId || null });
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg === 'smtp_not_configured') return res.status(503).json({ error: 'smtp_not_configured' });
      res.status(500).json({ error: 'email_send_failed' });
    }
  }
);

// ===== CONTRACTS (token link / public) =====

router.get('/contracts/by-token/:token', async (req, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'missing_token' });

  const prisma = getPrisma();
  const contract = await prisma.contract.findFirst({ where: { token } });
  if (!contract) return res.status(404).json({ error: 'contract_not_found' });

  res.json({ contract });
});

router.post('/contracts/by-token/:token/accept', async (req, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'missing_token' });

  const signedBy = String(req.body?.signedBy || '').trim();
  if (!signedBy) return res.status(400).json({ error: 'missing_signed_by' });

  const prisma = getPrisma();
  const contract = await prisma.contract.findFirst({ where: { token } });
  if (!contract) return res.status(404).json({ error: 'contract_not_found' });

  if (contract.status === 'ACCEPTED') return res.json({ contract });

  const updated = await prisma.contract.update({
    where: { id: contract.id },
    data: {
      status: 'ACCEPTED',
      signedBy,
      acceptedAt: new Date()
    }
  });

  res.json({ contract: updated });
});

export default router;
