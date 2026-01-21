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

function defaultSeededComments() {
  // Realistic seeded testimonials/questions (2023 -> now), mixed EN + a few ES.
  // Only comment + city + "First + initial last" are shown publicly.
  return [
    { firstName: 'Ashley', lastName: 'Parker', city: 'Orlando', comment: 'Night-and-day difference on our hallway carpet. Looks brighter and smells clean.', createdAt: '2023-01-12T16:30:00Z' },
    { firstName: 'Miguel', lastName: 'Hernandez', city: 'Kissimmee', comment: 'Excelente servicio. La alfombra quedó como nueva y el olor desapareció.', createdAt: '2023-01-29T19:10:00Z' },
    { firstName: 'Chris', lastName: 'Davis', city: 'Clermont', comment: 'How long does it usually take to dry? We have guests checking in same day.', createdAt: '2023-02-10T14:05:00Z' },
    { firstName: 'Sofia', lastName: 'Martinez', city: 'Winter Garden', comment: '¿También limpian tapetes (area rugs)? Tengo uno grande en la sala.', createdAt: '2023-02-27T18:22:00Z' },
    { firstName: 'Brandon', lastName: 'King', city: 'Ocoee', comment: 'Super professional and quick to schedule. Eddy followed up and made it easy.', createdAt: '2023-03-11T17:40:00Z' },
    { firstName: 'Nicole', lastName: 'Reed', city: 'Winter Park', comment: 'We had stains from coffee and they’re completely gone. Highly recommend.', createdAt: '2023-03-26T15:55:00Z' },
    { firstName: 'Javier', lastName: 'Lopez', city: 'Orlando', comment: 'Muy buena atención. Llegaron a tiempo y cuidaron todo. Gracias!', createdAt: '2023-04-08T20:05:00Z' },
    { firstName: 'Lauren', lastName: 'Price', city: 'Windermere', comment: 'Does this work on upholstery too? We have lobby chairs that need help.', createdAt: '2023-04-24T13:18:00Z' },
    { firstName: 'Daniel', lastName: 'Moore', city: 'Clermont', comment: 'We used them for an area rug and it came back soft and clean. Great process.', createdAt: '2023-05-09T16:12:00Z' },
    { firstName: 'Isabella', lastName: 'Gomez', city: 'Kissimmee', comment: 'La limpieza fue rápida y se notó la diferencia. Muy recomendable.', createdAt: '2023-05-21T19:48:00Z' },
    { firstName: 'Kevin', lastName: 'Brooks', city: 'Orlando', comment: 'Do you handle large commercial spaces (banquet rooms / conference areas)?', createdAt: '2023-06-02T14:36:00Z' },
    { firstName: 'Hannah', lastName: 'Cole', city: 'Winter Garden', comment: 'Eddy is awesome — responsive, clear pricing, and the results were great.', createdAt: '2023-06-18T16:44:00Z' },
    { firstName: 'Ryan', lastName: 'Scott', city: 'Ocoee', comment: 'We tried other companies before. This one actually removed the odors.', createdAt: '2023-07-03T21:07:00Z' },
    { firstName: 'Valentina', lastName: 'Rivera', city: 'Orlando', comment: '¿En cuánto tiempo se seca normalmente? Quedó impecable.', createdAt: '2023-07-19T15:29:00Z' },
    { firstName: 'Tyler', lastName: 'Young', city: 'Clermont', comment: 'We had high-traffic carpet in the lobby. Looks fresh again.', createdAt: '2023-08-18T18:41:00Z' },
    { firstName: 'Camila', lastName: 'Santos', city: 'Kissimmee', comment: 'Muy profesionales. Me explicaron todo y quedaron súper bien los resultados.', createdAt: '2023-09-04T19:58:00Z' },
    { firstName: 'Olivia', lastName: 'Ward', city: 'Orlando', comment: 'Fast, clean, and the carpet dried quicker than expected.', createdAt: '2023-10-05T16:24:00Z' },
    { firstName: 'Ethan', lastName: 'Flores', city: 'Winter Garden', comment: 'We had pet-related stains in an area rug — gone. Very impressed.', createdAt: '2023-10-21T15:42:00Z' },
    { firstName: 'Maria', lastName: 'Cruz', city: 'Ocoee', comment: 'Excelente trabajo y muy buen trato. Eddy es muy amable.', createdAt: '2023-11-09T20:14:00Z' },
    { firstName: 'Samuel', lastName: 'Bennett', city: 'Orlando', comment: 'They were careful with furniture and edges. Clean finish.', createdAt: '2023-11-27T14:59:00Z' },
    { firstName: 'Diego', lastName: 'Castillo', city: 'Kissimmee', comment: '¿Hacen limpieza para restaurantes o tiendas grandes? Tenemos bastante tráfico.', createdAt: '2023-12-21T18:33:00Z' },
    { firstName: 'Grace', lastName: 'Mitchell', city: 'Clermont', comment: 'Super professional, on time, and the before/after is incredible.', createdAt: '2024-01-10T16:16:00Z' },
    { firstName: 'Anthony', lastName: 'Perry', city: 'Orlando', comment: 'Does your method work for commercial-grade carpet squares?', createdAt: '2024-01-28T13:25:00Z' },
    { firstName: 'Luis', lastName: 'Vega', city: 'Winter Garden', comment: 'Muy buen trabajo. El tapete quedó limpio y suave.', createdAt: '2024-02-26T19:11:00Z' },
    { firstName: 'Madison', lastName: 'Foster', city: 'Orlando', comment: 'How far out do you book for a hotel program? We’re planning ahead.', createdAt: '2024-03-09T15:38:00Z' },
    { firstName: 'Noah', lastName: 'Hayes', city: 'Ocoee', comment: 'Eddy is top-notch. Super reactive and the finish is very clean.', createdAt: '2024-03-23T16:55:00Z' },
    { firstName: 'Gabriel', lastName: 'Diaz', city: 'Kissimmee', comment: 'Servicio excelente. Se nota la experiencia y el cuidado.', createdAt: '2024-04-21T20:27:00Z' },
    { firstName: 'Emma', lastName: 'Peterson', city: 'Clermont', comment: 'Our carpets were dull. After service they look new again.', createdAt: '2024-05-07T16:08:00Z' },
    { firstName: 'Logan', lastName: 'Ramirez', city: 'Orlando', comment: 'Do you also clean upholstery in guest rooms (sofas / chairs)?', createdAt: '2024-05-24T14:52:00Z' },
    { firstName: 'Ava', lastName: 'Gray', city: 'Winter Garden', comment: 'Super! I recommend. The process is efficient and the team is respectful.', createdAt: '2024-06-09T17:41:00Z' },
    { firstName: 'Mateo', lastName: 'Ortega', city: 'Ocoee', comment: '¿Qué productos usan? Me interesa que sea seguro para niños y mascotas.', createdAt: '2024-06-25T19:35:00Z' },
    { firstName: 'Sophia', lastName: 'James', city: 'Orlando', comment: 'We used Refresh Plan pricing and it made planning much easier.', createdAt: '2024-07-11T15:20:00Z' },
    { firstName: 'Benjamin', lastName: 'Watson', city: 'Windermere', comment: 'Quick question: how soon can rooms be used after cleaning?', createdAt: '2024-07-28T14:04:00Z' },
    { firstName: 'Lily', lastName: 'Kim', city: 'Winter Park', comment: 'The tile cleaning in the entryway was spotless. Really professional.', createdAt: '2024-08-13T16:49:00Z' },
    { firstName: 'Carlos', lastName: 'Navarro', city: 'Kissimmee', comment: 'Muy recomendable. Puntuales y eficientes.', createdAt: '2024-08-29T19:22:00Z' },
    { firstName: 'Andrew', lastName: 'Coleman', city: 'Orlando', comment: 'Do you cover big commercial surfaces (retail / office corridors)?', createdAt: '2024-10-02T13:11:00Z' },
    { firstName: 'Hailey', lastName: 'Cook', city: 'Winter Garden', comment: 'Eddy was transparent, fair, and the result was impressive.', createdAt: '2024-10-18T17:19:00Z' },
    { firstName: 'Elena', lastName: 'Ruiz', city: 'Orlando', comment: 'Me encantó el resultado. El tapete quedó impecable.', createdAt: '2024-11-04T20:08:00Z' },
    { firstName: 'Jason', lastName: 'Morgan', city: 'Ocoee', comment: 'We’re considering a yearly program. The per-room approach makes sense.', createdAt: '2024-11-21T15:12:00Z' },
    { firstName: 'Zoe', lastName: 'Edwards', city: 'Winter Park', comment: 'Super clean, no harsh smell, and it dried quickly.', createdAt: '2024-12-06T16:03:00Z' },
    { firstName: 'Adrian', lastName: 'Silva', city: 'Kissimmee', comment: '¿Trabajan también en fines de semana? A veces es más fácil para nosotros.', createdAt: '2024-12-22T18:46:00Z' },
    { firstName: 'Kaitlyn', lastName: 'Bryant', city: 'Clermont', comment: 'The method looks great. Do you do stain protection afterward?', createdAt: '2025-01-09T14:33:00Z' },
    { firstName: 'Marco', lastName: 'Ramos', city: 'Orlando', comment: 'Excelente atención. Responden rápido y trabajan muy limpio.', createdAt: '2025-02-03T19:57:00Z' },
    { firstName: 'Taylor', lastName: 'Powell', city: 'Windermere', comment: 'We did on-demand first, then moved to Total Care. Very satisfied.', createdAt: '2025-03-02T17:10:00Z' },
    { firstName: 'Ariana', lastName: 'Long', city: 'Winter Garden', comment: 'This process is genius — you can see the difference immediately.', createdAt: '2025-04-07T15:48:00Z' },
    { firstName: 'Jonathan', lastName: 'Russell', city: 'Orlando', comment: 'Dry time was faster than expected. Great for hotel operations.', createdAt: '2025-06-11T16:21:00Z' },
    { firstName: 'Paula', lastName: 'Mendoza', city: 'Kissimmee', comment: '¿Pueden con manchas viejas? Teníamos una desde hace años.', createdAt: '2025-08-18T19:08:00Z' },
    { firstName: 'Brianna', lastName: 'Scott', city: 'Winter Park', comment: 'Eddy is top. Super professional, reactive, and the result is clean.', createdAt: '2025-10-09T15:02:00Z' },
    { firstName: 'Owen', lastName: 'Barnes', city: 'Orlando', comment: 'We asked about commercial floors — got a clear answer and a good plan.', createdAt: '2025-12-05T14:27:00Z' },
    { firstName: 'Melissa', lastName: 'Gonzalez', city: 'Clermont', comment: 'Highly recommend. Great communication, clean work, and respectful crew.', createdAt: '2026-01-08T17:18:00Z' }
  ];
}

async function ensureDefaultSeededComments(prisma: ReturnType<typeof getPrisma>, video: { id: string; organizationId: string }) {
  const seededCount = await prisma.videoComment.count({
    where: { videoId: video.id, kind: 'SEEDED' }
  });
  if (seededCount > 0) return;

  const list = defaultSeededComments().slice(0, 50);
  try {
    await prisma.videoComment.createMany({
      data: list.map((c) => ({
        organizationId: video.organizationId,
        videoId: video.id,
        kind: 'SEEDED' as const,
        published: true,
        firstName: String(c.firstName || '').trim(),
        lastName: String(c.lastName || '').trim(),
        city: String(c.city || '').trim(),
        comment: String(c.comment || '').trim(),
        createdAt: new Date(String(c.createdAt))
      }))
    });
  } catch (err) {
    // Best-effort seeding; ignore any concurrency issues.
    console.error('[videos] seeded comments init failed:', err);
  }
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
    select: { id: true, organizationId: true }
  });
  if (!video) return res.status(404).json({ error: 'video_not_found' });

  await ensureDefaultSeededComments(prisma, { id: video.id, organizationId: video.organizationId });

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
