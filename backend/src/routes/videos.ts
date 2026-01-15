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

function safeName(input: string): string {
  const base = path.basename(String(input || '').trim());
  return base.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 180) || 'video';
}

function makeVideoKey(originalName: string): string {
  const ext = path.extname(originalName || '').slice(0, 12);
  const token = randomBytes(12).toString('hex');
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `videos/${yyyy}/${mm}/${yyyy}${mm}${String(now.getUTCDate()).padStart(2, '0')}-${token}${ext || '.mp4'}`;
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
          const originalName = safeName(file.originalname || 'video');
          const storagePath = makeVideoKey(originalName);
          (req as any)._videoStoragePath = storagePath;
          const full = resolveUploadPath(uploadsDir, storagePath);
          fs.mkdirSync(path.dirname(full), { recursive: true });
          cb(null, path.dirname(full));
        } catch (e) {
          cb(e as any, '');
        }
      },
      filename: (req, file, cb) => {
        try {
          const storagePath = String((req as any)._videoStoragePath || '');
          if (!storagePath) return cb(new Error('missing_storage_path'), '');
          cb(null, path.basename(storagePath));
        } catch (e) {
          cb(e as any, '');
        }
      }
    }),
    limits: {
      fileSize: 1024 * 1024 * 1024 // 1GB
    }
  });
})();

// ===== ADMIN (auth) =====

router.post(
  '/videos',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  upload.single('file'),
  async (req: AuthedRequest, res: Response) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: 'missing_file' });

    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const originalName = safeName(file.originalname || 'video');
    const mime = String(file.mimetype || '').trim();
    const sizeBytes = Number(file.size || 0) || 0;

    const storagePath = String((req as any)._videoStoragePath || '').trim();
    if (!storagePath) return res.status(500).json({ error: 'upload_failed' });

    const prisma = getPrisma();
    const video = await prisma.video.create({
      data: {
        organizationId: req.auth!.organizationId,
        uploadedByUserId: req.auth!.userId,
        title,
        description,
        originalName,
        mime,
        storagePath,
        sizeBytes,
        published: true
      }
    });

    res.status(201).json({ video });
  }
);

router.delete(
  '/videos/:videoId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const videoId = String(req.params.videoId || '').trim();
    if (!videoId) return res.status(400).json({ error: 'missing_video_id' });

    const prisma = getPrisma();
    const existing = await prisma.video.findFirst({
      where: { id: videoId, organizationId: req.auth!.organizationId }
    });
    if (!existing) return res.status(404).json({ error: 'video_not_found' });

    const { uploadsDir } = readUploadEnv();
    const fullPath = resolveUploadPath(uploadsDir, existing.storagePath);
    try {
      await fs.promises.unlink(fullPath);
    } catch {}

    await prisma.video.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  }
);

// ===== PUBLIC (no auth) =====

router.get('/public/videos', async (req, res: Response) => {
  const prisma = getPrisma();
  const videos = await prisma.video.findMany({
    where: { published: true },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      originalName: true,
      mime: true,
      sizeBytes: true,
      createdAt: true
    }
  });
  res.json({ videos });
});

router.get('/public/videos/:videoId/file', async (req, res: Response) => {
  const videoId = String(req.params.videoId || '').trim();
  if (!videoId) return res.status(400).json({ error: 'missing_video_id' });

  const prisma = getPrisma();
  const video = await prisma.video.findFirst({
    where: { id: videoId, published: true },
    select: { id: true, storagePath: true, mime: true, originalName: true, sizeBytes: true }
  });
  if (!video) return res.status(404).json({ error: 'video_not_found' });

  const { uploadsDir } = readUploadEnv();
  const fullPath = resolveUploadPath(uploadsDir, video.storagePath);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(fullPath);
  } catch {
    return res.status(404).json({ error: 'file_not_found' });
  }

  const total = stat.size;
  const range = String(req.headers.range || '').trim();
  const mime = video.mime || 'video/mp4';
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename="${safeName(video.originalName || 'video')}"`);

  if (!range) {
    res.setHeader('Content-Length', String(total));
    return fs.createReadStream(fullPath).pipe(res);
  }

  const m = /^bytes=(\d*)-(\d*)$/i.exec(range);
  if (!m) return res.status(416).end();

  const start = m[1] ? Math.max(0, parseInt(m[1], 10)) : 0;
  const end = m[2] ? Math.min(total - 1, parseInt(m[2], 10)) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return res.status(416).end();

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  res.setHeader('Content-Length', String(end - start + 1));
  fs.createReadStream(fullPath, { start, end }).pipe(res);
});

export default router;
