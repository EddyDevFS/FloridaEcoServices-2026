import { Router, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';
import { readUploadEnv } from '../uploads';

const router = Router();

function clampLen(input: any, max: number) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

function safeName(input: string): string {
  const base = path.basename(String(input || '').trim());
  return base.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 180) || 'thumb';
}

function makeThumbKey(originalName: string): string {
  const ext = path.extname(originalName || '').slice(0, 12);
  const token = randomBytes(12).toString('hex');
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `thumbnails/${yyyy}/${mm}/${yyyy}${mm}${String(now.getUTCDate()).padStart(2, '0')}-${token}${ext || '.webp'}`;
}

function resolveUploadPath(uploadsDir: string, storagePath: string): string {
  const rel = String(storagePath || '').replace(/^\/+/, '');
  const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
  return path.join(uploadsDir, normalized);
}

const upload = (() => {
  const { uploadsDir } = readUploadEnv();
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        try {
          const originalName = safeName(file.originalname || 'thumb');
          const storagePath = makeThumbKey(originalName);
          (req as any)._thumbStoragePath = storagePath;
          const full = resolveUploadPath(uploadsDir, storagePath);
          fs.mkdirSync(path.dirname(full), { recursive: true });
          cb(null, path.dirname(full));
        } catch (e) {
          cb(e as any, '');
        }
      },
      filename: (req, file, cb) => {
        try {
          const storagePath = String((req as any)._thumbStoragePath || '');
          if (!storagePath) return cb(new Error('missing_storage_path'), '');
          cb(null, path.basename(storagePath));
        } catch (e) {
          cb(e as any, '');
        }
      }
    }),
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB
  });
})();

// ===== ADMIN (auth) =====

router.get('/thumbnails', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const prisma = getPrisma();
  const list = await prisma.videoThumbnail.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      originalName: true,
      mime: true,
      sizeBytes: true,
      published: true,
      createdAt: true
    }
  });
  res.json({ thumbnails: list });
});

router.post(
  '/thumbnails',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  upload.single('file'),
  async (req: AuthedRequest, res: Response) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: 'missing_file' });

    const storagePath = String((req as any)._thumbStoragePath || '').trim();
    if (!storagePath) return res.status(400).json({ error: 'missing_storage_path' });

    const title = clampLen(req.body?.title, 120);
    const published = req.body?.published === undefined ? true : !!req.body.published;

    const prisma = getPrisma();
    const created = await prisma.videoThumbnail.create({
      data: {
        organizationId: req.auth!.organizationId,
        uploadedByUserId: req.auth!.userId,
        title,
        originalName: safeName(file.originalname || 'thumb'),
        mime: String(file.mimetype || ''),
        storagePath,
        sizeBytes: Number(file.size || 0),
        published
      },
      select: { id: true }
    });

    res.status(201).json({ thumbnail: { id: created.id } });
  }
);

// ===== PUBLIC (no auth) =====

router.get('/public/thumbnails', async (_req, res: Response) => {
  const prisma = getPrisma();
  const list = await prisma.videoThumbnail.findMany({
    where: { published: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, createdAt: true }
  });
  res.json({ thumbnails: list });
});

router.get('/public/thumbnails/:thumbnailId/file', async (req, res: Response) => {
  const thumbnailId = String(req.params.thumbnailId || '').trim();
  if (!thumbnailId) return res.status(400).json({ error: 'missing_thumbnail_id' });

  const prisma = getPrisma();
  const t = await prisma.videoThumbnail.findFirst({
    where: { id: thumbnailId, published: true },
    select: { id: true, storagePath: true, mime: true, originalName: true, sizeBytes: true }
  });
  if (!t) return res.status(404).json({ error: 'thumbnail_not_found' });

  const { uploadsDir } = readUploadEnv();
  const fullPath = resolveUploadPath(uploadsDir, t.storagePath);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(fullPath);
  } catch {
    return res.status(404).json({ error: 'file_not_found' });
  }

  res.setHeader('Content-Type', t.mime || 'image/webp');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Disposition', `inline; filename="${safeName(t.originalName || 'thumb')}"`);
  return fs.createReadStream(fullPath).pipe(res);
});

export default router;

