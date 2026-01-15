import { Router, type Response } from 'express';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireHotelScope } from '../auth/scope';

const router = Router();

async function resolveStaffId(organizationId: string, hotelId: string, idOrLegacy: string): Promise<string | null> {
  const v = String(idOrLegacy || '').trim();
  if (!v) return null;
  const prisma = getPrisma();
  const staff = await prisma.staffMember.findFirst({
    where: {
      organizationId,
      hotelId,
      OR: [{ id: v }, { legacyId: v }]
    },
    select: { id: true }
  });
  return staff?.id || null;
}

function normalizeStatus(status: string): 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED' {
  const v = String(status || '').trim().toUpperCase();
  if (v === 'OPEN' || v === 'IN_PROGRESS' || v === 'BLOCKED' || v === 'DONE' || v === 'CANCELLED') return v as any;
  return 'OPEN';
}

function normalizePriority(priority: string): 'NORMAL' | 'HIGH' | 'URGENT' {
  const v = String(priority || '').trim().toUpperCase();
  if (v === 'URGENT') return 'URGENT';
  if (v === 'HIGH') return 'HIGH';
  return 'NORMAL';
}

function normalizeCategory(category: string): 'TASK' | 'INCIDENT' {
  const v = String(category || '').trim().toUpperCase();
  if (v === 'INCIDENT') return 'INCIDENT';
  return 'TASK';
}

router.get('/hotels/:hotelId/tasks', requireAuth, async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.params.hotelId || '').trim();
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (!requireHotelScope(req, res, hotelId)) return;

  const prisma = getPrisma();
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!hotel) return res.status(404).json({ error: 'hotel_not_found' });

  const tasks = await prisma.task.findMany({
    where: { hotelId, organizationId: req.auth!.organizationId },
    orderBy: { createdAt: 'desc' },
    include: {
      locations: true,
      events: { orderBy: { at: 'asc' } },
      attachments: { orderBy: { at: 'asc' } }
    }
  });

  res.json({ tasks });
});

router.get('/tasks/:taskId', requireAuth, async (req: AuthedRequest, res: Response) => {
  const taskId = String(req.params.taskId || '').trim();
  if (!taskId) return res.status(400).json({ error: 'missing_task_id' });

  const prisma = getPrisma();
  const task = await prisma.task.findFirst({
    where: { id: taskId, organizationId: req.auth!.organizationId },
    include: {
      locations: true,
      events: { orderBy: { at: 'asc' } },
      attachments: { orderBy: { at: 'asc' } }
    }
  });
  if (!task) return res.status(404).json({ error: 'task_not_found' });
  if (!requireHotelScope(req, res, task.hotelId)) return;

  const attachments = task.attachments.map((a) => ({
    ...a,
    url: a.storagePath ? `/api/v1/tasks/${task.id}/attachments/${a.id}/file` : null
  }));

  res.json({ task: { ...task, attachments } });
});

async function findTaskByLegacyOrId(orgId: string, legacyOrId: string) {
  const prisma = getPrisma();
  return prisma.task.findFirst({
    where: {
      organizationId: orgId,
      OR: [{ legacyId: legacyOrId }, { id: legacyOrId }]
    },
    select: { id: true, hotelId: true }
  });
}

router.get('/tasks/by-legacy/:legacyTaskId', requireAuth, async (req: AuthedRequest, res: Response) => {
  const legacyTaskId = String(req.params.legacyTaskId || '').trim();
  if (!legacyTaskId) return res.status(400).json({ error: 'missing_task_id' });

  const prisma = getPrisma();
  const task = await prisma.task.findFirst({
    where: { organizationId: req.auth!.organizationId, OR: [{ legacyId: legacyTaskId }, { id: legacyTaskId }] },
    include: {
      locations: true,
      events: { orderBy: { at: 'asc' } },
      attachments: { orderBy: { at: 'asc' } }
    }
  });
  if (!task) return res.status(404).json({ error: 'task_not_found' });
  if (!requireHotelScope(req, res, task.hotelId)) return;

  const attachments = task.attachments.map((a) => ({
    ...a,
    url: a.storagePath ? `/api/v1/tasks/${task.id}/attachments/${a.id}/file` : null
  }));

  res.json({ task: { ...task, attachments } });
});

router.post('/hotels/:hotelId/tasks', requireAuth, async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.params.hotelId || '').trim();
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (!requireHotelScope(req, res, hotelId)) return;

  const prisma = getPrisma();
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!hotel) return res.status(404).json({ error: 'hotel_not_found' });

  const category = normalizeCategory(req.body?.category);
  const status = normalizeStatus(req.body?.status);
  const priority = normalizePriority(req.body?.priority);
  const type = String(req.body?.type || 'OTHER').trim() || 'OTHER';
  const description = String(req.body?.description || '').trim();
  const assignedStaffIdRaw = req.body?.assignedStaffId ? String(req.body.assignedStaffId).trim() : null;
  const schedule = req.body?.schedule ?? null;
  const actorRole = String(req.body?.actorRole || 'hotel_manager').trim() || 'hotel_manager';
  const actorStaffIdRaw = req.body?.actorStaffId ? String(req.body.actorStaffId).trim() : null;

  const assignedStaffId = assignedStaffIdRaw ? await resolveStaffId(req.auth!.organizationId, hotelId, assignedStaffIdRaw) : null;
  if (assignedStaffIdRaw && !assignedStaffId) return res.status(400).json({ error: 'invalid_assigned_staff' });

  const actorStaffId = actorStaffIdRaw ? await resolveStaffId(req.auth!.organizationId, hotelId, actorStaffIdRaw) : null;
  if (actorStaffIdRaw && !actorStaffId) return res.status(400).json({ error: 'invalid_actor_staff' });

  const locationsIn = Array.isArray(req.body?.locations) ? req.body.locations : null;
  const fallbackLabel = String(req.body?.location?.label || '').trim();
  const locations =
    locationsIn && locationsIn.length
      ? locationsIn
      : fallbackLabel
        ? [{ label: fallbackLabel }]
        : [];

  const created = await prisma.task.create({
    data: {
      organizationId: req.auth!.organizationId,
      hotelId,
      category,
      status,
      type,
      priority,
      description,
      assignedStaffId: assignedStaffId || undefined,
      schedule: schedule === null ? undefined : schedule,
      locations: {
        create: locations.map((l: any) => ({
          label: String(l?.label || '').trim(),
          roomId: l?.roomId ? String(l.roomId).trim() : undefined,
          spaceId: l?.spaceId ? String(l.spaceId).trim() : undefined
        }))
      },
      events: {
        create: [
          {
            action: 'CREATED',
            actorRole,
            actorStaffId: actorStaffId || undefined,
            note: description
          }
        ]
      }
    },
    include: { locations: true, events: true, attachments: true }
  });

  res.status(201).json({ task: created });
});

router.patch('/tasks/:taskId', requireAuth, async (req: AuthedRequest, res: Response) => {
  const taskId = String(req.params.taskId || '').trim();
  if (!taskId) return res.status(400).json({ error: 'missing_task_id' });

  const prisma = getPrisma();
  const task = await prisma.task.findFirst({
    where: { id: taskId, organizationId: req.auth!.organizationId },
    select: { id: true, hotelId: true }
  });
  if (!task) return res.status(404).json({ error: 'task_not_found' });
  if (!requireHotelScope(req, res, task.hotelId)) return;

  const patch: any = {};
  if (req.body?.status !== undefined) patch.status = normalizeStatus(req.body.status);
  if (req.body?.priority !== undefined) patch.priority = normalizePriority(req.body.priority);
  if (req.body?.type !== undefined) patch.type = String(req.body.type || 'OTHER').trim() || 'OTHER';
  if (req.body?.description !== undefined) patch.description = String(req.body.description || '').trim();
  if (req.body?.assignedStaffId !== undefined) {
    const v = req.body.assignedStaffId;
    const raw = v ? String(v).trim() : '';
    if (!raw) patch.assignedStaffId = null;
    else {
      const resolved = await resolveStaffId(req.auth!.organizationId, task.hotelId, raw);
      if (!resolved) return res.status(400).json({ error: 'invalid_assigned_staff' });
      patch.assignedStaffId = resolved;
    }
  }
  if (req.body?.schedule !== undefined) patch.schedule = req.body.schedule;

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: patch,
    include: { locations: true, events: { orderBy: { at: 'asc' } }, attachments: { orderBy: { at: 'asc' } } }
  });

  res.json({ task: updated });
});

router.patch('/tasks/by-legacy/:legacyTaskId', requireAuth, async (req: AuthedRequest, res: Response) => {
  const legacyTaskId = String(req.params.legacyTaskId || '').trim();
  if (!legacyTaskId) return res.status(400).json({ error: 'missing_task_id' });

  const task = await findTaskByLegacyOrId(req.auth!.organizationId, legacyTaskId);
  if (!task) return res.status(404).json({ error: 'task_not_found' });
  if (!requireHotelScope(req, res, task.hotelId)) return;

  const prisma = getPrisma();
  const patch: any = {};
  if (req.body?.status !== undefined) patch.status = normalizeStatus(req.body.status);
  if (req.body?.priority !== undefined) patch.priority = normalizePriority(req.body.priority);
  if (req.body?.type !== undefined) patch.type = String(req.body.type || 'OTHER').trim() || 'OTHER';
  if (req.body?.description !== undefined) patch.description = String(req.body.description || '').trim();
  if (req.body?.assignedStaffId !== undefined) {
    const v = req.body.assignedStaffId;
    const raw = v ? String(v).trim() : '';
    if (!raw) patch.assignedStaffId = null;
    else {
      const resolved = await resolveStaffId(req.auth!.organizationId, task.hotelId, raw);
      if (!resolved) return res.status(400).json({ error: 'invalid_assigned_staff' });
      patch.assignedStaffId = resolved;
    }
  }
  if (req.body?.schedule !== undefined) patch.schedule = req.body.schedule;

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: patch,
    include: { locations: true, events: { orderBy: { at: 'asc' } }, attachments: { orderBy: { at: 'asc' } } }
  });

  const attachments = updated.attachments.map((a) => ({
    ...a,
    url: a.storagePath ? `/api/v1/tasks/${updated.id}/attachments/${a.id}/file` : null
  }));

  res.json({ task: { ...updated, attachments } });
});

router.post('/tasks/:taskId/events', requireAuth, async (req: AuthedRequest, res: Response) => {
  const taskId = String(req.params.taskId || '').trim();
  if (!taskId) return res.status(400).json({ error: 'missing_task_id' });

  const action = String(req.body?.action || '').trim();
  if (!action) return res.status(400).json({ error: 'missing_action' });

  const prisma = getPrisma();
  const task = await prisma.task.findFirst({
    where: { id: taskId, organizationId: req.auth!.organizationId },
    select: { id: true, hotelId: true }
  });
  if (!task) return res.status(404).json({ error: 'task_not_found' });
  if (!requireHotelScope(req, res, task.hotelId)) return;

  const actorRole = String(req.body?.actorRole || 'hotel_manager').trim() || 'hotel_manager';
  const actorStaffIdRaw = req.body?.actorStaffId ? String(req.body.actorStaffId).trim() : null;
  const actorStaffId = actorStaffIdRaw ? await resolveStaffId(req.auth!.organizationId, task.hotelId, actorStaffIdRaw) : null;
  if (actorStaffIdRaw && !actorStaffId) return res.status(400).json({ error: 'invalid_actor_staff' });
  const note = String(req.body?.note || '').trim();
  const patch = req.body?.patch ?? null;

  const event = await prisma.taskEvent.create({
    data: {
      taskId,
      action,
      actorRole,
      actorStaffId: actorStaffId || undefined,
      note,
      patch: patch === null ? undefined : patch
    }
  });

  res.status(201).json({ event });
});

router.post('/tasks/by-legacy/:legacyTaskId/events', requireAuth, async (req: AuthedRequest, res: Response) => {
  const legacyTaskId = String(req.params.legacyTaskId || '').trim();
  if (!legacyTaskId) return res.status(400).json({ error: 'missing_task_id' });

  const action = String(req.body?.action || '').trim();
  if (!action) return res.status(400).json({ error: 'missing_action' });

  const task = await findTaskByLegacyOrId(req.auth!.organizationId, legacyTaskId);
  if (!task) return res.status(404).json({ error: 'task_not_found' });
  if (!requireHotelScope(req, res, task.hotelId)) return;

  const actorRole = String(req.body?.actorRole || 'hotel_manager').trim() || 'hotel_manager';
  const actorStaffIdRaw = req.body?.actorStaffId ? String(req.body.actorStaffId).trim() : null;
  const actorStaffId = actorStaffIdRaw ? await resolveStaffId(req.auth!.organizationId, task.hotelId, actorStaffIdRaw) : null;
  if (actorStaffIdRaw && !actorStaffId) return res.status(400).json({ error: 'invalid_actor_staff' });
  const note = String(req.body?.note || '').trim();
  const patch = req.body?.patch ?? null;

  const prisma = getPrisma();
  const event = await prisma.taskEvent.create({
    data: {
      taskId: task.id,
      action,
      actorRole,
      actorStaffId: actorStaffId || undefined,
      note,
      patch: patch === null ? undefined : patch
    }
  });

  res.status(201).json({ event });
});

export default router;
