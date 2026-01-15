import { type NextFunction, type Response } from 'express';
import { type Role } from '@prisma/client';
import { type AuthedRequest } from './middleware';

export function requireRole(allowed: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const role = req.auth?.role;
    if (!role) return res.status(401).json({ error: 'missing_access_token' });
    if (!allowed.includes(role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

