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

function incidentShape(task: any) {
  const locations = Array.isArray(task.locations) ? task.locations : [];
  const room = String(locations[0]?.label || '').trim();
  return { ...task, room };
}

router.get('/hotels/:hotelId/incidents', requireAuth, async (req: AuthedRequest, res: Response) => {
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
    where: { hotelId, organizationId: req.auth!.organizationId, category: 'INCIDENT' },
    orderBy: { createdAt: 'desc' },
    include: { locations: true, events: { orderBy: { at: 'asc' } }, attachments: { orderBy: { at: 'asc' } } }
  });

  res.json({ incidents: tasks.map(incidentShape) });
});

router.post('/hotels/:hotelId/incidents', requireAuth, async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.params.hotelId || '').trim();
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (!requireHotelScope(req, res, hotelId)) return;

  const room = String(req.body?.room || req.body?.location?.label || '').trim();
  if (!room) return res.status(400).json({ error: 'missing_room' });

  const prisma = getPrisma();
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!hotel) return res.status(404).json({ error: 'hotel_not_found' });

  const status = normalizeStatus(req.body?.status);
  const priority = normalizePriority(req.body?.priority);
  const type = String(req.body?.type || 'OTHER').trim() || 'OTHER';
  const description = String(req.body?.description || '').trim();
  const assignedStaffIdRaw = req.body?.assignedStaffId ? String(req.body.assignedStaffId).trim() : null;
  const assignedStaffId = assignedStaffIdRaw ? await resolveStaffId(req.auth!.organizationId, hotelId, assignedStaffIdRaw) : null;
  if (assignedStaffIdRaw && !assignedStaffId) return res.status(400).json({ error: 'invalid_assigned_staff' });

  const created = await prisma.task.create({
    data: {
      organizationId: req.auth!.organizationId,
      hotelId,
      category: 'INCIDENT',
      status,
      type,
      priority,
      description,
      assignedStaffId: assignedStaffId || undefined,
      locations: { create: [{ label: room }] },
      events: {
        create: [
          {
            action: 'CREATED',
            actorRole: String(req.body?.actorRole || 'hotel_manager').trim() || 'hotel_manager',
            actorStaffId: req.body?.actorStaffId ? String(req.body.actorStaffId).trim() : undefined,
            note: description || room
          }
        ]
      }
    },
    include: { locations: true, events: { orderBy: { at: 'asc' } }, attachments: { orderBy: { at: 'asc' } } }
  });

  res.status(201).json({ incident: incidentShape(created) });
});

router.get('/incidents/:incidentId', requireAuth, async (req: AuthedRequest, res: Response) => {
  const incidentId = String(req.params.incidentId || '').trim();
  if (!incidentId) return res.status(400).json({ error: 'missing_incident_id' });

  const prisma = getPrisma();
  const task = await prisma.task.findFirst({
    where: { id: incidentId, organizationId: req.auth!.organizationId, category: 'INCIDENT' },
    include: { locations: true, events: { orderBy: { at: 'asc' } }, attachments: { orderBy: { at: 'asc' } } }
  });
  if (!task) return res.status(404).json({ error: 'incident_not_found' });
  if (!requireHotelScope(req, res, task.hotelId)) return;

  res.json({ incident: incidentShape(task) });
});

router.patch('/incidents/:incidentId', requireAuth, async (req: AuthedRequest, res: Response) => {
  const incidentId = String(req.params.incidentId || '').trim();
  if (!incidentId) return res.status(400).json({ error: 'missing_incident_id' });

  const prisma = getPrisma();
  const task = await prisma.task.findFirst({
    where: { id: incidentId, organizationId: req.auth!.organizationId, category: 'INCIDENT' },
    select: { id: true, hotelId: true }
  });
  if (!task) return res.status(404).json({ error: 'incident_not_found' });
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

  const updated = await prisma.task.update({
    where: { id: incidentId },
    data: patch,
    include: { locations: true, events: { orderBy: { at: 'asc' } }, attachments: { orderBy: { at: 'asc' } } }
  });

  res.json({ incident: incidentShape(updated) });
});

router.post('/incidents/:incidentId/events', requireAuth, async (req: AuthedRequest, res: Response) => {
  const incidentId = String(req.params.incidentId || '').trim();
  if (!incidentId) return res.status(400).json({ error: 'missing_incident_id' });

  const action = String(req.body?.action || '').trim();
  if (!action) return res.status(400).json({ error: 'missing_action' });

  const prisma = getPrisma();
  const task = await prisma.task.findFirst({
    where: { id: incidentId, organizationId: req.auth!.organizationId, category: 'INCIDENT' },
    select: { id: true, hotelId: true }
  });
  if (!task) return res.status(404).json({ error: 'incident_not_found' });
  if (!requireHotelScope(req, res, task.hotelId)) return;

  const event = await prisma.taskEvent.create({
    data: {
      taskId: incidentId,
      action,
      actorRole: String(req.body?.actorRole || 'hotel_manager').trim() || 'hotel_manager',
      actorStaffId: req.body?.actorStaffId ? String(req.body.actorStaffId).trim() : undefined,
      note: String(req.body?.note || '').trim(),
      patch: req.body?.patch ?? undefined
    }
  });

  res.status(201).json({ event });
});

router.get('/staff/:staffId/incidents', requireAuth, async (req: AuthedRequest, res: Response) => {
  const staffId = String(req.params.staffId || '').trim();
  if (!staffId) return res.status(400).json({ error: 'missing_staff_id' });

  const hotelId = req.query.hotelId ? String(req.query.hotelId).trim() : null;

  const prisma = getPrisma();
  const member = await prisma.staffMember.findFirst({
    where: { id: staffId, organizationId: req.auth!.organizationId },
    select: { id: true, hotelId: true }
  });
  if (!member) return res.status(404).json({ error: 'staff_not_found' });
  if (!requireHotelScope(req, res, member.hotelId)) return;
  if (hotelId && hotelId !== member.hotelId) return res.status(404).json({ error: 'staff_not_in_hotel' });

  const incidents = await prisma.task.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      assignedStaffId: staffId,
      category: 'INCIDENT',
      ...(hotelId ? { hotelId } : {})
    },
    orderBy: { createdAt: 'desc' },
    include: { locations: true, events: { orderBy: { at: 'asc' } }, attachments: { orderBy: { at: 'asc' } } }
  });

  res.json({ incidents: incidents.map(incidentShape) });
});

export default router;
