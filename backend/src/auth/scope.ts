import { type Response } from 'express';
import { type AuthedRequest } from './middleware';

export function getHotelScopeId(req: AuthedRequest): string | null {
  const raw = (req.auth as any)?.hotelScopeId;
  const v = raw ? String(raw).trim() : '';
  return v || null;
}

export function canAccessHotel(req: AuthedRequest, hotelId: string): boolean {
  const role = req.auth?.role;
  if (role === 'SUPER_ADMIN') return true;
  const scope = getHotelScopeId(req);
  if (!scope) return false;
  return scope === hotelId;
}

export function requireHotelScope(req: AuthedRequest, res: Response, hotelId: string): boolean {
  if (canAccessHotel(req, hotelId)) return true;
  res.status(403).json({ error: 'forbidden_hotel_scope' });
  return false;
}

