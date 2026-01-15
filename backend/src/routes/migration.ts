import { Router, type Response } from 'express';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';
import { exportLocalStorage, importLocalStorage } from '../migration/localStorage';

const router = Router();

router.get('/migration/localstorage/export', requireAuth, async (req: AuthedRequest, res: Response) => {
  const prisma = getPrisma();
  const payload = await exportLocalStorage(prisma, req.auth!.organizationId, req.auth!.userId);
  res.json({ data: payload });
});

router.post(
  '/migration/localstorage/import',
  requireAuth,
  requireRole(['SUPER_ADMIN', 'HOTEL_ADMIN', 'MANAGER']),
  async (req: AuthedRequest, res: Response) => {
    const prisma = getPrisma();
    const summary = await importLocalStorage(prisma, req.auth!.organizationId, req.auth!.userId, req.body);
    res.json({ ok: true, summary });
  }
);

export default router;
