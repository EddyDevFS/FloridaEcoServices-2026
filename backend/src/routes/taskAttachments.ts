import { Router, type Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireHotelScope } from '../auth/scope';
import { makeUploadKey, readUploadEnv, writeUploadFile } from '../uploads';
import path from 'path';
import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 } // 12MB
});

function isAllowedImageMime(mime: string): boolean {
  const m = String(mime || '').toLowerCase();
  return m === 'image/jpeg' || m === 'image/png' || m === 'image/webp' || m === 'image/heic' || m === 'image/heif';
}

function resolveUploadPath(uploadsDir: string, storagePath: string): string | null {
  const rel = String(storagePath || '').replace(/^\/+/, '');
  if (!rel || rel.includes('\0')) return null;
  const normalized = path.posix.normalize(rel);
  if (normalized.startsWith('..') || normalized.includes('/..')) return null;
  return path.join(uploadsDir, normalized);
}

router.post(
  '/tasks/:taskId/attachments',
  requireAuth,
  upload.single('file'),
  async (req: AuthedRequest, res: Response) => {
    const taskId = String(req.params.taskId || '').trim();
    if (!taskId) return res.status(400).json({ error: 'missing_task_id' });

    const file = req.file;
    if (!file) return res.status(400).json({ error: 'missing_file' });
    if (!isAllowedImageMime(file.mimetype)) return res.status(400).json({ error: 'unsupported_mime' });

    const prisma = getPrisma();
    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId: req.auth!.organizationId },
      select: { id: true, hotelId: true }
    });
    if (!task) return res.status(404).json({ error: 'task_not_found' });
    if (!requireHotelScope(req, res, task.hotelId)) return;

    const { uploadsDir } = readUploadEnv();

    // Resize + rotate based on EXIF; keep webp output for size
    const out = await sharp(file.buffer, { failOnError: false })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const outMeta = await sharp(out, { failOnError: false }).metadata();

    const { relativePath } = makeUploadKey('webp');
    await writeUploadFile(uploadsDir, relativePath, out);

    const actorStaffIdRaw = req.body?.actorStaffId ? String(req.body.actorStaffId).trim() : '';
    const actorStaffId = actorStaffIdRaw
      ? (
          await prisma.staffMember.findFirst({
            where: {
              organizationId: req.auth!.organizationId,
              hotelId: task.hotelId,
              OR: [{ id: actorStaffIdRaw }, { legacyId: actorStaffIdRaw }]
            },
            select: { id: true }
          })
        )?.id
      : undefined;

    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId,
        name: file.originalname || 'photo',
        mime: 'image/webp',
        storagePath: relativePath,
        sizeBytes: out.length,
        width: outMeta.width || null,
        height: outMeta.height || null,
        actorRole: String(req.body?.actorRole || 'hotel_staff'),
        actorStaffId
      }
    });

    await prisma.taskEvent.create({
      data: {
        taskId,
        action: 'PHOTO_ADDED',
        actorRole: String(req.body?.actorRole || 'hotel_staff'),
        actorStaffId: req.body?.actorStaffId ? String(req.body.actorStaffId) : undefined,
        note: attachment.name
      }
    });

    res.status(201).json({
      attachment: {
        ...attachment,
        url: `/api/v1/tasks/${taskId}/attachments/${attachment.id}/file`
      }
    });
  }
);

router.post(
  '/tasks/by-legacy/:legacyTaskId/attachments',
  requireAuth,
  upload.single('file'),
  async (req: AuthedRequest, res: Response) => {
    const legacyTaskId = String(req.params.legacyTaskId || '').trim();
    if (!legacyTaskId) return res.status(400).json({ error: 'missing_task_id' });

    const file = req.file;
    if (!file) return res.status(400).json({ error: 'missing_file' });
    if (!isAllowedImageMime(file.mimetype)) return res.status(400).json({ error: 'unsupported_mime' });

    const prisma = getPrisma();
    const task = await prisma.task.findFirst({
      where: {
        organizationId: req.auth!.organizationId,
        OR: [{ legacyId: legacyTaskId }, { id: legacyTaskId }]
      },
      select: { id: true, hotelId: true }
    });
    if (!task) return res.status(404).json({ error: 'task_not_found' });
    if (!requireHotelScope(req, res, task.hotelId)) return;

    const { uploadsDir } = readUploadEnv();
    const out = await sharp(file.buffer, { failOnError: false })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const outMeta = await sharp(out, { failOnError: false }).metadata();

    const { relativePath } = makeUploadKey('webp');
    await writeUploadFile(uploadsDir, relativePath, out);

    const actorStaffIdRaw = req.body?.actorStaffId ? String(req.body.actorStaffId).trim() : '';
    const actorStaffId = actorStaffIdRaw
      ? (
          await prisma.staffMember.findFirst({
            where: {
              organizationId: req.auth!.organizationId,
              hotelId: task.hotelId,
              OR: [{ id: actorStaffIdRaw }, { legacyId: actorStaffIdRaw }]
            },
            select: { id: true }
          })
        )?.id
      : undefined;

    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId: task.id,
        name: file.originalname || 'photo',
        mime: 'image/webp',
        storagePath: relativePath,
        sizeBytes: out.length,
        width: outMeta.width || null,
        height: outMeta.height || null,
        actorRole: String(req.body?.actorRole || 'hotel_staff'),
        actorStaffId
      }
    });

    await prisma.taskEvent.create({
      data: {
        taskId: task.id,
        action: 'PHOTO_ADDED',
        actorRole: String(req.body?.actorRole || 'hotel_staff'),
        actorStaffId: req.body?.actorStaffId ? String(req.body.actorStaffId) : undefined,
        note: attachment.name
      }
    });

    res.status(201).json({
      attachment: {
        ...attachment,
        url: `/api/v1/tasks/${task.id}/attachments/${attachment.id}/file`
      }
    });
  }
);

router.get('/tasks/:taskId/attachments', requireAuth, async (req: AuthedRequest, res: Response) => {
  const taskId = String(req.params.taskId || '').trim();
  if (!taskId) return res.status(400).json({ error: 'missing_task_id' });

  const prisma = getPrisma();
  const task = await prisma.task.findFirst({
    where: { id: taskId, organizationId: req.auth!.organizationId },
    select: { id: true, hotelId: true }
  });
  if (!task) return res.status(404).json({ error: 'task_not_found' });
  if (!requireHotelScope(req, res, task.hotelId)) return;

  const attachments = await prisma.taskAttachment.findMany({
    where: { taskId },
    orderBy: { at: 'asc' }
  });

  res.json({
    attachments: attachments.map((a) => ({
      ...a,
      url: a.storagePath ? `/api/v1/tasks/${taskId}/attachments/${a.id}/file` : null
    }))
  });
});

router.get('/tasks/:taskId/attachments/:attachmentId/file', requireAuth, async (req: AuthedRequest, res: Response) => {
  const taskId = String(req.params.taskId || '').trim();
  const attachmentId = String(req.params.attachmentId || '').trim();
  if (!taskId) return res.status(400).json({ error: 'missing_task_id' });
  if (!attachmentId) return res.status(400).json({ error: 'missing_attachment_id' });

  const prisma = getPrisma();
  const attachment = await prisma.taskAttachment.findFirst({
    where: {
      id: attachmentId,
      taskId,
      task: { organizationId: req.auth!.organizationId }
    },
    select: { id: true, mime: true, name: true, storagePath: true, task: { select: { hotelId: true } } }
  });
  if (!attachment) return res.status(404).json({ error: 'attachment_not_found' });
  if (!requireHotelScope(req, res, attachment.task.hotelId)) return;
  if (!attachment.storagePath) return res.status(404).json({ error: 'attachment_no_file' });

  const { uploadsDir } = readUploadEnv();
  const fullPath = resolveUploadPath(uploadsDir, attachment.storagePath);
  if (!fullPath) return res.status(404).json({ error: 'attachment_bad_path' });

  res.setHeader('Content-Type', attachment.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.name || 'photo')}"`);

  const stream = createReadStream(fullPath);
  stream.on('error', () => res.status(404).end());
  stream.pipe(res);
});

router.delete('/tasks/:taskId/attachments/:attachmentId', requireAuth, async (req: AuthedRequest, res: Response) => {
  const taskId = String(req.params.taskId || '').trim();
  const attachmentId = String(req.params.attachmentId || '').trim();
  if (!taskId) return res.status(400).json({ error: 'missing_task_id' });
  if (!attachmentId) return res.status(400).json({ error: 'missing_attachment_id' });

  const prisma = getPrisma();
  const attachment = await prisma.taskAttachment.findFirst({
    where: {
      id: attachmentId,
      taskId,
      task: { organizationId: req.auth!.organizationId }
    },
    include: { task: { select: { hotelId: true } } }
  });
  if (!attachment) return res.status(404).json({ error: 'attachment_not_found' });
  if (!requireHotelScope(req, res, attachment.task.hotelId)) return;

  if (attachment.storagePath) {
    const { uploadsDir } = readUploadEnv();
    const fullPath = resolveUploadPath(uploadsDir, attachment.storagePath);
    if (fullPath) {
      try {
        await unlink(fullPath);
      } catch {
        // ignore (already deleted / missing)
      }
    }
  }

  await prisma.$transaction([
    prisma.taskEvent.create({
      data: {
        taskId,
        action: 'PHOTO_DELETED',
        actorRole: 'hotel_manager',
        note: attachment.name,
        patch: { attachmentId }
      }
    }),
    prisma.taskAttachment.delete({ where: { id: attachmentId } })
  ]);

  res.json({ ok: true });
});

export default router;
