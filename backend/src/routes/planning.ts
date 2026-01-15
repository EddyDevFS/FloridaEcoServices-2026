import { Router, type Response } from 'express';
import { randomBytes } from 'crypto';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';
import { requireHotelScope } from '../auth/scope';

const router = Router();

function makeReservationToken(): string {
  return `resv_${randomBytes(12).toString('hex')}`;
}

function normalizeSurfaceType(v: any): 'BOTH' | 'CARPET' | 'TILE' {
  const s = String(v || '').trim().toUpperCase();
  if (s === 'CARPET' || s === 'TILE' || s === 'BOTH') return s;
  return 'BOTH';
}

function normalizeReservationStatus(v: any): 'PROPOSED' | 'PENDING' | 'APPROVED' | 'CANCELLED' {
  const s = String(v || '').trim().toUpperCase();
  if (s === 'PROPOSED' || s === 'PENDING' || s === 'APPROVED' || s === 'CANCELLED') return s;
  return 'PROPOSED';
}

function pickReservationPatch(body: any) {
  const patch: any = {};

  if (body?.statusAdmin !== undefined) patch.statusAdmin = normalizeReservationStatus(body.statusAdmin);
  if (body?.statusHotel !== undefined) patch.statusHotel = normalizeReservationStatus(body.statusHotel);

  if (body?.roomIds !== undefined) patch.roomIds = body.roomIds;
  if (body?.spaceIds !== undefined) patch.spaceIds = body.spaceIds;
  if (body?.roomNotes !== undefined) patch.roomNotes = body.roomNotes;
  if (body?.spaceNotes !== undefined) patch.spaceNotes = body.spaceNotes;
  if (body?.surfaceDefault !== undefined) patch.surfaceDefault = normalizeSurfaceType(body.surfaceDefault);
  if (body?.roomSurfaceOverrides !== undefined) patch.roomSurfaceOverrides = body.roomSurfaceOverrides;

  if (body?.notesGlobal !== undefined) patch.notesGlobal = String(body.notesGlobal || '');
  if (body?.notesOrg !== undefined) patch.notesOrg = String(body.notesOrg || '');
  if (body?.durationMinutes !== undefined) patch.durationMinutes = Number(body.durationMinutes) || 0;
  if (body?.proposedDate !== undefined) patch.proposedDate = String(body.proposedDate || '');
  if (body?.proposedStart !== undefined) patch.proposedStart = String(body.proposedStart || '');
  if (body?.confirmedAt !== undefined) {
    if (!body.confirmedAt) {
      patch.confirmedAt = null;
    } else {
      const d = new Date(String(body.confirmedAt));
      if (!Number.isFinite(d.getTime())) patch.confirmedAt = null;
      else patch.confirmedAt = d;
    }
  }
  if (body?.requiresAdminApproval !== undefined) patch.requiresAdminApproval = Boolean(body.requiresAdminApproval);

  return patch;
}

function reservationPublicShape(r: any) {
  return {
    id: r.id,
    token: r.token,
    statusAdmin: r.statusAdmin,
    statusHotel: r.statusHotel,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    confirmedAt: r.confirmedAt,
    requiresAdminApproval: r.requiresAdminApproval,
    cancelledAt: r.cancelledAt,
    cancelledBy: r.cancelledBy,
    cancelReason: r.cancelReason,
    hotelId: r.hotelId,
    roomIds: r.roomIds,
    spaceIds: r.spaceIds,
    roomNotes: r.roomNotes,
    spaceNotes: r.spaceNotes,
    surfaceDefault: r.surfaceDefault,
    roomSurfaceOverrides: r.roomSurfaceOverrides,
    notesGlobal: r.notesGlobal,
    notesOrg: r.notesOrg,
    durationMinutes: r.durationMinutes,
    proposedDate: r.proposedDate,
    proposedStart: r.proposedStart
  };
}

// ===== RESERVATIONS (auth) =====

router.get('/hotels/:hotelId/reservations', requireAuth, async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.params.hotelId || '').trim();
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (!requireHotelScope(req, res, hotelId)) return;

  const prisma = getPrisma();
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!hotel) return res.status(404).json({ error: 'hotel_not_found' });

  const reservations = await prisma.reservation.findMany({
    where: { hotelId, organizationId: req.auth!.organizationId },
    orderBy: { createdAt: 'desc' }
  });

  res.json({ reservations });
});

router.post('/hotels/:hotelId/reservations', requireAuth, async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.params.hotelId || '').trim();
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (!requireHotelScope(req, res, hotelId)) return;

  const prisma = getPrisma();
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!hotel) return res.status(404).json({ error: 'hotel_not_found' });

  const reservation = await prisma.reservation.create({
    data: {
      organizationId: req.auth!.organizationId,
      hotelId,
      token: makeReservationToken(),
      statusAdmin: 'PROPOSED',
      statusHotel: 'PENDING',
      roomIds: Array.isArray(req.body?.roomIds) ? req.body.roomIds : [],
      spaceIds: Array.isArray(req.body?.spaceIds) ? req.body.spaceIds : [],
      roomNotes: req.body?.roomNotes ?? {},
      spaceNotes: req.body?.spaceNotes ?? {},
      surfaceDefault: normalizeSurfaceType(req.body?.surfaceDefault),
      roomSurfaceOverrides: req.body?.roomSurfaceOverrides ?? {},
      notesGlobal: String(req.body?.notesGlobal || ''),
      notesOrg: String(req.body?.notesOrg || ''),
      durationMinutes: Number(req.body?.durationMinutes) || 0,
      proposedDate: String(req.body?.proposedDate || ''),
      proposedStart: String(req.body?.proposedStart || '')
    }
  });

  res.status(201).json({ reservation });
});

router.patch('/reservations/:reservationId', requireAuth, async (req: AuthedRequest, res: Response) => {
  const reservationId = String(req.params.reservationId || '').trim();
  if (!reservationId) return res.status(400).json({ error: 'missing_reservation_id' });

  const prisma = getPrisma();
  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, organizationId: req.auth!.organizationId }
  });
  if (!reservation) return res.status(404).json({ error: 'reservation_not_found' });

  if (req.body?.roomIds !== undefined && !Array.isArray(req.body.roomIds)) {
    return res.status(400).json({ error: 'invalid_room_ids' });
  }
  if (req.body?.spaceIds !== undefined && !Array.isArray(req.body.spaceIds)) {
    return res.status(400).json({ error: 'invalid_space_ids' });
  }

  const patch = pickReservationPatch(req.body);
  const updated = await prisma.reservation.update({
    where: { id: reservationId },
    data: patch
  });

  res.json({ reservation: updated });
});

router.post('/reservations/:reservationId/cancel', requireAuth, async (req: AuthedRequest, res: Response) => {
  const reservationId = String(req.params.reservationId || '').trim();
  if (!reservationId) return res.status(400).json({ error: 'missing_reservation_id' });

  const prisma = getPrisma();
  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!reservation) return res.status(404).json({ error: 'reservation_not_found' });

  const by = String(req.body?.by || 'admin').trim() || 'admin';
  const reason = String(req.body?.reason || '').trim();
  const now = new Date();

  const updated = await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      statusAdmin: 'CANCELLED',
      statusHotel: 'CANCELLED',
      cancelledAt: now,
      cancelledBy: by,
      cancelReason: reason
    }
  });

  res.json({ reservation: updated });
});

router.delete('/reservations/:reservationId', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const reservationId = String(req.params.reservationId || '').trim();
  if (!reservationId) return res.status(400).json({ error: 'missing_reservation_id' });

  const prisma = getPrisma();
  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!reservation) return res.status(404).json({ error: 'reservation_not_found' });

  await prisma.reservation.delete({ where: { id: reservationId } });
  res.json({ ok: true });
});

// ===== RESERVATIONS (token link / public) =====

router.get('/reservations/by-token/:token', async (req, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'missing_token' });

  const prisma = getPrisma();
  const reservation = await prisma.reservation.findFirst({ where: { token } });
  if (!reservation) return res.status(404).json({ error: 'reservation_not_found' });

  res.json({ reservation: reservationPublicShape(reservation) });
});

router.patch('/reservations/by-token/:token', async (req, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'missing_token' });

  const prisma = getPrisma();
  const reservation = await prisma.reservation.findFirst({ where: { token } });
  if (!reservation) return res.status(404).json({ error: 'reservation_not_found' });

  // Token-based edits are intentionally limited (hotel-side flow).
  const patch: any = {};
  if (req.body?.notesOrg !== undefined) patch.notesOrg = String(req.body.notesOrg || '');
  if (req.body?.proposedDate !== undefined) patch.proposedDate = String(req.body.proposedDate || '');
  if (req.body?.proposedStart !== undefined) patch.proposedStart = String(req.body.proposedStart || '');
  if (req.body?.requiresAdminApproval !== undefined) patch.requiresAdminApproval = Boolean(req.body.requiresAdminApproval);

  if (req.body?.statusHotel !== undefined) {
    patch.statusHotel = normalizeReservationStatus(req.body.statusHotel);
    if (patch.statusHotel === 'APPROVED' && !reservation.confirmedAt) patch.confirmedAt = new Date();
  }

  // Hotel can propose a change that forces admin review.
  if (req.body?.statusAdmin !== undefined) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const updated = await prisma.reservation.update({
    where: { id: reservation.id },
    data: patch
  });

  res.json({ reservation: reservationPublicShape(updated) });
});

router.post('/reservations/by-token/:token/cancel', async (req, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'missing_token' });

  const prisma = getPrisma();
  const reservation = await prisma.reservation.findFirst({ where: { token } });
  if (!reservation) return res.status(404).json({ error: 'reservation_not_found' });

  const reason = String(req.body?.reason || '').trim();
  const now = new Date();
  const updated = await prisma.reservation.update({
    where: { id: reservation.id },
    data: {
      statusAdmin: 'CANCELLED',
      statusHotel: 'CANCELLED',
      cancelledAt: now,
      cancelledBy: 'hotel',
      cancelReason: reason
    }
  });

  res.json({ reservation: reservationPublicShape(updated) });
});

// ===== BLOCKED SLOTS (org) =====

router.get('/blocked-slots', requireAuth, async (req: AuthedRequest, res: Response) => {
  const prisma = getPrisma();
  const slots = await prisma.blockedSlot.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { date: 'asc' }
  });
  res.json({ blockedSlots: slots });
});

router.post('/blocked-slots', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const legacyId = req.body?.legacyId ? String(req.body.legacyId).trim() : '';
  const date = String(req.body?.date || '').trim();
  const start = String(req.body?.start || '').trim();
  const end = String(req.body?.end || '').trim();
  const note = String(req.body?.note || '').trim();
  if (!date || !start || !end) return res.status(400).json({ error: 'missing_date_or_time' });

  const prisma = getPrisma();
  if (legacyId) {
    const existing = await prisma.blockedSlot.findUnique({
      where: { organizationId_legacyId: { organizationId: req.auth!.organizationId, legacyId } }
    });
    if (existing) {
      const updated = await prisma.blockedSlot.update({
        where: { id: existing.id },
        data: { date, start, end, note }
      });
      return res.json({ blockedSlot: updated });
    }
  }

  const slot = await prisma.blockedSlot.create({
    data: { organizationId: req.auth!.organizationId, legacyId: legacyId || undefined, date, start, end, note }
  });
  return res.status(201).json({ blockedSlot: slot });
});

router.delete('/blocked-slots/:slotId', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const slotId = String(req.params.slotId || '').trim();
  if (!slotId) return res.status(400).json({ error: 'missing_slot_id' });

  const prisma = getPrisma();
  const slot = await prisma.blockedSlot.findFirst({
    where: { organizationId: req.auth!.organizationId, OR: [{ id: slotId }, { legacyId: slotId }] },
    select: { id: true }
  });
  if (!slot) return res.status(404).json({ error: 'blocked_slot_not_found' });

  await prisma.blockedSlot.delete({ where: { id: slot.id } });
  res.json({ ok: true });
});

// ===== TECHNICIANS (org) =====

router.get('/technicians', requireAuth, async (req: AuthedRequest, res: Response) => {
  const prisma = getPrisma();
  const technicians = await prisma.technician.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { name: 'asc' }
  });
  res.json({ technicians });
});

router.post('/technicians', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const legacyId = req.body?.legacyId ? String(req.body.legacyId).trim() : '';
  const name = String(req.body?.name || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const notes = String(req.body?.notes || '').trim();
  if (!name) return res.status(400).json({ error: 'missing_name' });

  const prisma = getPrisma();
  if (legacyId) {
    const existing = await prisma.technician.findUnique({
      where: { organizationId_legacyId: { organizationId: req.auth!.organizationId, legacyId } }
    });
    if (existing) {
      const updated = await prisma.technician.update({
        where: { id: existing.id },
        data: { name, phone, notes, active: true }
      });
      return res.json({ technician: updated });
    }
  }

  const technician = await prisma.technician.create({
    data: { organizationId: req.auth!.organizationId, legacyId: legacyId || undefined, name, phone, notes, active: true }
  });
  return res.status(201).json({ technician });
});

router.patch('/technicians/:technicianId', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const technicianId = String(req.params.technicianId || '').trim();
  if (!technicianId) return res.status(400).json({ error: 'missing_technician_id' });

  const prisma = getPrisma();
  const tech = await prisma.technician.findFirst({
    where: { organizationId: req.auth!.organizationId, OR: [{ id: technicianId }, { legacyId: technicianId }] },
    select: { id: true }
  });
  if (!tech) return res.status(404).json({ error: 'technician_not_found' });

  const patch: any = {};
  if (req.body?.name !== undefined) patch.name = String(req.body.name || '').trim();
  if (req.body?.phone !== undefined) patch.phone = String(req.body.phone || '').trim();
  if (req.body?.notes !== undefined) patch.notes = String(req.body.notes || '').trim();
  if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);

  const updated = await prisma.technician.update({ where: { id: tech.id }, data: patch });
  res.json({ technician: updated });
});

router.delete('/technicians/:technicianId', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const technicianId = String(req.params.technicianId || '').trim();
  if (!technicianId) return res.status(400).json({ error: 'missing_technician_id' });

  const prisma = getPrisma();
  const tech = await prisma.technician.findFirst({
    where: { organizationId: req.auth!.organizationId, OR: [{ id: technicianId }, { legacyId: technicianId }] },
    select: { id: true }
  });
  if (!tech) return res.status(404).json({ error: 'technician_not_found' });

  await prisma.technician.delete({ where: { id: tech.id } });
  res.json({ ok: true });
});

// ===== SESSIONS (hotel) =====

router.get('/hotels/:hotelId/sessions', requireAuth, async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.params.hotelId || '').trim();
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (!requireHotelScope(req, res, hotelId)) return;

  const prisma = getPrisma();
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!hotel) return res.status(404).json({ error: 'hotel_not_found' });

  const sessions = await prisma.session.findMany({
    where: { hotelId, organizationId: req.auth!.organizationId },
    orderBy: { date: 'asc' }
  });
  res.json({ sessions });
});

router.post('/hotels/:hotelId/sessions', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.params.hotelId || '').trim();
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (!requireHotelScope(req, res, hotelId)) return;

  const legacyId = req.body?.legacyId ? String(req.body.legacyId).trim() : '';
  const date = String(req.body?.date || '').trim();
  const start = String(req.body?.start || '').trim();
  const end = String(req.body?.end || '').trim();
  const technicianId = req.body?.technicianId ? String(req.body.technicianId).trim() : null;
  const roomIds = Array.isArray(req.body?.roomIds) ? req.body.roomIds : [];
  if (!date || !start || !end) return res.status(400).json({ error: 'missing_date_or_time' });

  const prisma = getPrisma();
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!hotel) return res.status(404).json({ error: 'hotel_not_found' });

  if (technicianId) {
    const tech = await prisma.technician.findFirst({
      where: { id: technicianId, organizationId: req.auth!.organizationId },
      select: { id: true }
    });
    if (!tech) return res.status(400).json({ error: 'invalid_technician' });
  }

  if (legacyId) {
    const existing = await prisma.session.findUnique({
      where: { organizationId_legacyId: { organizationId: req.auth!.organizationId, legacyId } }
    });
    if (existing) {
      const updated = await prisma.session.update({
        where: { id: existing.id },
        data: {
          hotelId,
          roomIds,
          date,
          start,
          end,
          technicianId: technicianId || null
        }
      });
      return res.json({ session: updated });
    }
  }

  const session = await prisma.session.create({
    data: {
      organizationId: req.auth!.organizationId,
      legacyId: legacyId || undefined,
      hotelId,
      roomIds,
      date,
      start,
      end,
      technicianId: technicianId || undefined
    }
  });

  return res.status(201).json({ session });
});

router.delete('/hotels/:hotelId/sessions/:sessionId', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.params.hotelId || '').trim();
  const sessionId = String(req.params.sessionId || '').trim();
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (!sessionId) return res.status(400).json({ error: 'missing_session_id' });
  if (!requireHotelScope(req, res, hotelId)) return;

  const prisma = getPrisma();
  const session = await prisma.session.findFirst({
    where: {
      organizationId: req.auth!.organizationId,
      hotelId,
      OR: [{ id: sessionId }, { legacyId: sessionId }]
    },
    select: { id: true }
  });
  if (!session) return res.status(404).json({ error: 'session_not_found' });

  await prisma.session.delete({ where: { id: session.id } });
  return res.json({ ok: true });
});

export default router;
