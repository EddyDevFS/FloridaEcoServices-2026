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

function isLikelyEmail(input: string) {
  const s = String(input || '').trim();
  return !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

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

router.get('/public/videos/:videoId/comments', async (req, res: Response) => {
  const videoId = String(req.params.videoId || '').trim();
  if (!videoId) return res.status(400).json({ error: 'missing_video_id' });

  const prisma = getPrisma();
  const video = await prisma.video.findFirst({
    where: { id: videoId, published: true },
    select: { id: true }
  });
  if (!video) return res.status(404).json({ error: 'video_not_found' });

  const comments = await prisma.videoComment.findMany({
    where: {
      videoId,
      published: true
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      city: true,
      comment: true,
      createdAt: true
    }
  });

  const publicComments = comments.map((c) => {
    const firstName = String(c.firstName || '').trim();
    const lastName = String(c.lastName || '').trim();
    const lastInitial = lastName ? `${lastName[0].toUpperCase()}.` : '';
    return {
      id: c.id,
      name: [firstName, lastInitial].filter(Boolean).join(' '),
      city: String(c.city || '').trim(),
      comment: String(c.comment || '').trim(),
      createdAt: c.createdAt
    };
  });

  res.json({ comments: publicComments });
});

router.post('/public/videos/:videoId/comments', async (req, res: Response) => {
  const videoId = String(req.params.videoId || '').trim();
  if (!videoId) return res.status(400).json({ error: 'missing_video_id' });

  const firstName = clampLen(req.body?.firstName, 60);
  const lastName = clampLen(req.body?.lastName, 60);
  const city = clampLen(req.body?.city, 80);
  const email = clampLen(req.body?.email, 120).toLowerCase();
  const phone = clampLen(req.body?.phone, 40);
  const comment = clampLen(req.body?.comment, 800);

  if (!firstName || !lastName || !city || !email || !phone || !comment) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (!isLikelyEmail(email)) return res.status(400).json({ error: 'invalid_email' });

  const prisma = getPrisma();
  const video = await prisma.video.findFirst({
    where: { id: videoId, published: true },
    select: { id: true, organizationId: true }
  });
  if (!video) return res.status(404).json({ error: 'video_not_found' });

  const created = await prisma.videoComment.create({
    data: {
      organizationId: video.organizationId,
      videoId: video.id,
      kind: 'PUBLIC',
      published: true,
      firstName,
      lastName,
      city,
      email,
      phone,
      comment
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      city: true,
      comment: true,
      createdAt: true
    }
  });

  const lastInitial = created.lastName ? `${created.lastName[0].toUpperCase()}.` : '';
  res.status(201).json({
    comment: {
      id: created.id,
      name: [created.firstName, lastInitial].filter(Boolean).join(' '),
      city: created.city,
      comment: created.comment,
      createdAt: created.createdAt
    }
  });
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

// ===== COMMENTS ADMIN (auth) =====

router.get('/videos/:videoId/comments', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const videoId = String(req.params.videoId || '').trim();
  if (!videoId) return res.status(400).json({ error: 'missing_video_id' });
  const kind = String(req.query?.kind || '').toUpperCase().trim(); // SEEDED | PUBLIC | ''

  const prisma = getPrisma();
  const video = await prisma.video.findFirst({
    where: { id: videoId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!video) return res.status(404).json({ error: 'video_not_found' });

  const where: any = { videoId };
  if (kind === 'SEEDED' || kind === 'PUBLIC') where.kind = kind;

  const comments = await prisma.videoComment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      kind: true,
      published: true,
      firstName: true,
      lastName: true,
      city: true,
      email: true,
      phone: true,
      comment: true,
      createdAt: true
    }
  });

  res.json({ comments });
});

router.post('/videos/:videoId/comments/seeded', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const videoId = String(req.params.videoId || '').trim();
  if (!videoId) return res.status(400).json({ error: 'missing_video_id' });

  const firstName = clampLen(req.body?.firstName, 60);
  const lastName = clampLen(req.body?.lastName, 60);
  const city = clampLen(req.body?.city, 80);
  const comment = clampLen(req.body?.comment, 800);
  const date = clampLen(req.body?.date, 40); // optional: ISO string

  if (!firstName || !lastName || !city || !comment) return res.status(400).json({ error: 'missing_fields' });

  const prisma = getPrisma();
  const video = await prisma.video.findFirst({
    where: { id: videoId, organizationId: req.auth!.organizationId },
    select: { id: true, organizationId: true }
  });
  if (!video) return res.status(404).json({ error: 'video_not_found' });

  const createdAt = date ? new Date(date) : new Date();
  const created = await prisma.videoComment.create({
    data: {
      organizationId: video.organizationId,
      videoId: video.id,
      kind: 'SEEDED',
      published: true,
      firstName,
      lastName,
      city,
      comment,
      createdAt: Number.isFinite(createdAt.getTime()) ? createdAt : new Date()
    },
    select: { id: true, createdAt: true }
  });

  res.status(201).json({ id: created.id, createdAt: created.createdAt });
});

router.patch('/videos/comments/:commentId', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const commentId = String(req.params.commentId || '').trim();
  if (!commentId) return res.status(400).json({ error: 'missing_comment_id' });

  const prisma = getPrisma();
  const existing = await prisma.videoComment.findFirst({
    where: { id: commentId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!existing) return res.status(404).json({ error: 'comment_not_found' });

  const patch: any = {};
  if (req.body?.published !== undefined) patch.published = !!req.body.published;
  if (req.body?.firstName !== undefined) patch.firstName = clampLen(req.body.firstName, 60);
  if (req.body?.lastName !== undefined) patch.lastName = clampLen(req.body.lastName, 60);
  if (req.body?.city !== undefined) patch.city = clampLen(req.body.city, 80);
  if (req.body?.comment !== undefined) patch.comment = clampLen(req.body.comment, 800);
  if (req.body?.email !== undefined) patch.email = clampLen(req.body.email, 120).toLowerCase();
  if (req.body?.phone !== undefined) patch.phone = clampLen(req.body.phone, 40);

  const updated = await prisma.videoComment.update({
    where: { id: commentId },
    data: patch
  });

  res.json({ comment: updated });
});

router.delete('/videos/comments/:commentId', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const commentId = String(req.params.commentId || '').trim();
  if (!commentId) return res.status(400).json({ error: 'missing_comment_id' });

  const prisma = getPrisma();
  const existing = await prisma.videoComment.findFirst({
    where: { id: commentId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!existing) return res.status(404).json({ error: 'comment_not_found' });

  await prisma.videoComment.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

export default router;
