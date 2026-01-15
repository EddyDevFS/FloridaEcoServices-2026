import { Router, type Response } from 'express';
import { randomBytes } from 'crypto';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';
import { requireHotelScope } from '../auth/scope';

const router = Router();

function makeStaffToken(): string {
  return `stafftok_${randomBytes(12).toString('hex')}`;
}

router.get('/hotels/:hotelId/staff', requireAuth, async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.params.hotelId || '').trim();
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (!requireHotelScope(req, res, hotelId)) return;

  const includeInactive = String(req.query.includeInactive || '').trim() === '1';

  const prisma = getPrisma();
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!hotel) return res.status(404).json({ error: 'hotel_not_found' });

  const staff = await prisma.staffMember.findMany({
    where: {
      hotelId,
      organizationId: req.auth!.organizationId,
      ...(includeInactive ? {} : { active: true })
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: {
      id: true,
      token: true,
      hotelId: true,
      firstName: true,
      lastName: true,
      phone: true,
      notes: true,
      active: true,
      createdAt: true,
      updatedAt: true
    }
  });

  res.json({ staff });
});

router.post(
  '/hotels/:hotelId/staff',
  requireAuth,
  requireRole(['SUPER_ADMIN', 'HOTEL_ADMIN', 'MANAGER']),
  async (req: AuthedRequest, res: Response) => {
    const hotelId = String(req.params.hotelId || '').trim();
    if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
    if (!requireHotelScope(req, res, hotelId)) return;

    const firstName = String(req.body?.firstName || '').trim();
    const lastName = String(req.body?.lastName || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const notes = String(req.body?.notes || '').trim();
    if (!firstName && !lastName) return res.status(400).json({ error: 'missing_name' });

    const prisma = getPrisma();
    const hotel = await prisma.hotel.findFirst({
      where: { id: hotelId, organizationId: req.auth!.organizationId },
      select: { id: true }
    });
    if (!hotel) return res.status(404).json({ error: 'hotel_not_found' });

    const member = await prisma.staffMember.create({
      data: {
        token: makeStaffToken(),
        organizationId: req.auth!.organizationId,
        hotelId,
        firstName,
        lastName,
        phone,
        notes,
        active: true
      },
      select: {
        id: true,
        token: true,
        hotelId: true,
        firstName: true,
        lastName: true,
        phone: true,
        notes: true,
        active: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.status(201).json({ staff: member });
  }
);

router.patch(
  '/staff/:staffId',
  requireAuth,
  requireRole(['SUPER_ADMIN', 'HOTEL_ADMIN', 'MANAGER']),
  async (req: AuthedRequest, res: Response) => {
    const staffId = String(req.params.staffId || '').trim();
    if (!staffId) return res.status(400).json({ error: 'missing_staff_id' });

    const prisma = getPrisma();
    const member = await prisma.staffMember.findFirst({
      where: { id: staffId, organizationId: req.auth!.organizationId },
      select: { id: true }
    });
    if (!member) return res.status(404).json({ error: 'staff_not_found' });

    const patch: any = {};
    if (req.body?.firstName !== undefined) patch.firstName = String(req.body.firstName || '').trim();
    if (req.body?.lastName !== undefined) patch.lastName = String(req.body.lastName || '').trim();
    if (req.body?.phone !== undefined) patch.phone = String(req.body.phone || '').trim();
    if (req.body?.notes !== undefined) patch.notes = String(req.body.notes || '').trim();
    if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);

    const updated = await prisma.staffMember.update({
      where: { id: staffId },
      data: patch,
      select: {
        id: true,
        token: true,
        hotelId: true,
        firstName: true,
        lastName: true,
        phone: true,
        notes: true,
        active: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({ staff: updated });
  }
);

router.get('/staff/by-token/:token', requireAuth, async (req: AuthedRequest, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'missing_token' });

  const prisma = getPrisma();
  const member = await prisma.staffMember.findFirst({
    where: { token, organizationId: req.auth!.organizationId },
    select: {
      id: true,
      token: true,
      hotelId: true,
      firstName: true,
      lastName: true,
      phone: true,
      notes: true,
      active: true,
      createdAt: true,
      updatedAt: true
    }
  });
  if (!member) return res.status(404).json({ error: 'staff_not_found' });
  if (!requireHotelScope(req, res, member.hotelId)) return;
  res.json({ staff: member });
});

router.get('/staff/:staffId/tasks', requireAuth, async (req: AuthedRequest, res: Response) => {
  const staffId = String(req.params.staffId || '').trim();
  if (!staffId) return res.status(400).json({ error: 'missing_staff_id' });

  const hotelId = req.query.hotelId ? String(req.query.hotelId).trim() : null;

  const prisma = getPrisma();
  const member = await prisma.staffMember.findFirst({
    where: { id: staffId, organizationId: req.auth!.organizationId },
    select: { id: true, hotelId: true }
  });
  if (!member) return res.status(404).json({ error: 'staff_not_found' });
  if (!requireHotelScope(req, res, member.hotelId)) return;

  if (hotelId && hotelId !== member.hotelId) return res.status(404).json({ error: 'staff_not_in_hotel' });

  const tasks = await prisma.task.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      assignedStaffId: staffId,
      ...(hotelId ? { hotelId } : {})
    },
    orderBy: { createdAt: 'desc' },
    include: { locations: true, events: { orderBy: { at: 'asc' } }, attachments: { orderBy: { at: 'asc' } } }
  });

  res.json({ tasks });
});

export default router;
