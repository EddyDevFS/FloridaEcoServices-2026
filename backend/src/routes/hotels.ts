import { Router, type Response } from 'express';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';
import { getHotelScopeId } from '../auth/scope';

const router = Router();

router.get('/', requireAuth, async (req: AuthedRequest, res: Response) => {
  const prisma = getPrisma();
  const scopeHotelId = getHotelScopeId(req);
  const hotels = await prisma.hotel.findMany({
    where: { organizationId: req.auth!.organizationId, ...(scopeHotelId ? { id: scopeHotelId } : {}) },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, createdAt: true, updatedAt: true }
  });
  res.json({ hotels });
});

router.post('/', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'missing_name' });

  const prisma = getPrisma();
  const hotel = await prisma.hotel.create({
    data: { name, organizationId: req.auth!.organizationId },
    select: { id: true, name: true, createdAt: true, updatedAt: true }
  });
  res.status(201).json({ hotel });
});

router.patch('/:hotelId', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.params.hotelId || '').trim();
  const name = req.body?.name === undefined ? undefined : String(req.body.name || '').trim();
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (name !== undefined && !name) return res.status(400).json({ error: 'missing_name' });

  const prisma = getPrisma();
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!hotel) return res.status(404).json({ error: 'hotel_not_found' });

  const updated = await prisma.hotel.update({
    where: { id: hotelId },
    data: { ...(name !== undefined ? { name } : {}) },
    select: { id: true, name: true, createdAt: true, updatedAt: true }
  });
  res.json({ hotel: updated });
});

export default router;
