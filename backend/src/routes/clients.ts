import { Router, type Response } from 'express';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';

const router = Router();

function normalizeText(v: any) {
  return String(v || '').trim();
}

router.get('/clients', requireAuth, async (req: AuthedRequest, res: Response) => {
  const prisma = getPrisma();
  const limitRaw = Number(req.query?.limit || 200);
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 200));

  const clients = await prisma.client.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { updatedAt: 'desc' },
    take: limit
  });

  res.json({ clients });
});

router.post(
  '/clients',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const prisma = getPrisma();
    const company = normalizeText(req.body?.company);
    const contact = normalizeText(req.body?.contact);
    const email = normalizeText(req.body?.email);
    const phone = normalizeText(req.body?.phone);

    if (!company && !contact && !email && !phone) return res.status(400).json({ error: 'missing_client_details' });

    const client = await prisma.client.create({
      data: {
        organizationId: req.auth!.organizationId,
        company,
        contact,
        email,
        phone
      }
    });

    res.status(201).json({ client });
  }
);

export default router;

