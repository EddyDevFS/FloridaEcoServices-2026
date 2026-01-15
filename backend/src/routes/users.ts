import { Router, type Response } from 'express';
import argon2 from 'argon2';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';

const router = Router();

function normalizeEmail(email: any): string {
  return String(email || '').trim().toLowerCase();
}

function normalizeRole(role: any): 'SUPER_ADMIN' | 'HOTEL_ADMIN' | 'MANAGER' | 'STAFF' {
  const v = String(role || '').trim().toUpperCase();
  if (v === 'HOTEL_ADMIN' || v === 'MANAGER' || v === 'STAFF' || v === 'SUPER_ADMIN') return v as any;
  return 'HOTEL_ADMIN';
}

router.get('/users', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const prisma = getPrisma();
  const users = await prisma.user.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      role: true,
      activeHotelId: true,
      hotelScopeId: true,
      createdAt: true,
      updatedAt: true
    }
  });
  res.json({ users });
});

router.post('/users', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const role = normalizeRole(req.body?.role);
  const hotelScopeId = req.body?.hotelScopeId ? String(req.body.hotelScopeId).trim() : '';
  if (!email) return res.status(400).json({ error: 'missing_email' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'weak_password' });

  const prisma = getPrisma();
  let scopeHotelId: string | null = null;
  if (hotelScopeId) {
    const hotel = await prisma.hotel.findFirst({
      where: { id: hotelScopeId, organizationId: req.auth!.organizationId },
      select: { id: true }
    });
    if (!hotel) return res.status(400).json({ error: 'invalid_hotel_scope' });
    scopeHotelId = hotel.id;
  }

  const passwordHash = await argon2.hash(password);

  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: role as any,
        organizationId: req.auth!.organizationId,
        hotelScopeId: scopeHotelId,
        activeHotelId: scopeHotelId || undefined
      },
      select: {
        id: true,
        email: true,
        role: true,
        activeHotelId: true,
        hotelScopeId: true,
        createdAt: true,
        updatedAt: true
      }
    });
    res.status(201).json({ user });
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (msg.toLowerCase().includes('unique') || msg.toLowerCase().includes('duplicate')) {
      return res.status(409).json({ error: 'email_already_exists' });
    }
    return res.status(500).json({ error: 'create_user_failed' });
  }
});

export default router;

