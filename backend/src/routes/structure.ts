import { Router, type Response } from 'express';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';
import { requireHotelScope } from '../auth/scope';

const router = Router();

function parseOptionalPositiveInt(value: any, max = 100000): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const i = Math.floor(n);
  if (i > max) return undefined;
  return i;
}

function parseOptionalNonNegativeInt(value: any, max = 100000): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  const i = Math.floor(n);
  if (i > max) return undefined;
  return i;
}

function parseOptionalDate(value: any): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return undefined;
    return d;
  }
  const d = new Date(String(value));
  if (!Number.isFinite(d.getTime())) return undefined;
  return d;
}

async function requireHotelInOrg(organizationId: string, hotelId: string) {
  const prisma = getPrisma();
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, organizationId },
    select: { id: true }
  });
  if (!hotel) return null;
  return hotel;
}

router.get('/hotels/:hotelId/buildings', requireAuth, async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.params.hotelId || '').trim();
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (!requireHotelScope(req, res, hotelId)) return;

  const ok = await requireHotelInOrg(req.auth!.organizationId, hotelId);
  if (!ok) return res.status(404).json({ error: 'hotel_not_found' });

  const prisma = getPrisma();
  const buildings = await prisma.building.findMany({
    where: { hotelId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, notes: true, createdAt: true, updatedAt: true }
  });
  res.json({ buildings });
});

router.get('/hotels/:hotelId/structure', requireAuth, async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.params.hotelId || '').trim();
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (!requireHotelScope(req, res, hotelId)) return;

  const ok = await requireHotelInOrg(req.auth!.organizationId, hotelId);
  if (!ok) return res.status(404).json({ error: 'hotel_not_found' });

  const prisma = getPrisma();
  const buildings = await prisma.building.findMany({
    where: { hotelId },
    orderBy: { createdAt: 'asc' },
    include: {
      floors: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          rooms: { orderBy: { roomNumber: 'asc' } },
          spaces: { orderBy: { name: 'asc' } }
        }
      }
    }
  });

  const payload = buildings.map((b) => ({
    id: b.id,
    name: b.name,
    notes: b.notes || '',
    floors: (b.floors || []).map((f) => ({
      id: f.id,
      nameOrNumber: f.nameOrNumber,
      sortOrder: f.sortOrder ?? null,
      notes: f.notes || '',
      rooms: (f.rooms || []).map((r) => ({
        id: r.id,
        roomNumber: r.roomNumber,
        active: r.active,
        surface: r.surface,
        sqft: r.sqft ?? null,
        cleaningFrequency: r.cleaningFrequencyDays ?? null,
        lastCleaned: r.lastCleanedAt ? r.lastCleanedAt.getTime() : null,
        notes: r.notes || ''
      })),
      spaces: (f.spaces || []).map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        active: s.active,
        sqft: s.sqft ?? null,
        cleaningFrequency: s.cleaningFrequencyDays ?? null
      }))
    }))
  }));

  res.json({ buildings: payload });
});

router.post(
  '/hotels/:hotelId/buildings',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const hotelId = String(req.params.hotelId || '').trim();
    const name = String(req.body?.name || '').trim();
    const notes = String(req.body?.notes || '').trim();
    if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
    if (!name) return res.status(400).json({ error: 'missing_name' });
    if (!requireHotelScope(req, res, hotelId)) return;

    const ok = await requireHotelInOrg(req.auth!.organizationId, hotelId);
    if (!ok) return res.status(404).json({ error: 'hotel_not_found' });

    const prisma = getPrisma();
    const building = await prisma.building.create({
      data: { hotelId, name, notes },
      select: { id: true, name: true, notes: true, createdAt: true, updatedAt: true }
    });
    res.status(201).json({ building });
  }
);

router.patch(
  '/buildings/:buildingId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const buildingId = String(req.params.buildingId || '').trim();
    const name = req.body?.name === undefined ? undefined : String(req.body.name || '').trim();
    const notes = req.body?.notes === undefined ? undefined : String(req.body.notes || '').trim();
    if (!buildingId) return res.status(400).json({ error: 'missing_building_id' });
    if (name !== undefined && !name) return res.status(400).json({ error: 'missing_name' });

    const prisma = getPrisma();
    const building = await prisma.building.findFirst({
      where: { id: buildingId, hotel: { organizationId: req.auth!.organizationId } },
      select: { id: true }
    });
    if (!building) return res.status(404).json({ error: 'building_not_found' });

    const updated = await prisma.building.update({
      where: { id: buildingId },
      data: { ...(name !== undefined ? { name } : {}), ...(notes !== undefined ? { notes } : {}) },
      select: { id: true, name: true, notes: true, createdAt: true, updatedAt: true }
    });
    res.json({ building: updated });
  }
);

router.delete(
  '/buildings/:buildingId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const buildingId = String(req.params.buildingId || '').trim();
    if (!buildingId) return res.status(400).json({ error: 'missing_building_id' });

    const prisma = getPrisma();
    const building = await prisma.building.findFirst({
      where: { id: buildingId, hotel: { organizationId: req.auth!.organizationId } },
      select: { id: true }
    });
    if (!building) return res.status(404).json({ error: 'building_not_found' });

    await prisma.building.delete({ where: { id: buildingId } });
    res.json({ ok: true });
  }
);

router.get('/buildings/:buildingId/floors', requireAuth, async (req: AuthedRequest, res: Response) => {
  const buildingId = String(req.params.buildingId || '').trim();
  if (!buildingId) return res.status(400).json({ error: 'missing_building_id' });

  const prisma = getPrisma();
  const building = await prisma.building.findFirst({
    where: { id: buildingId, hotel: { organizationId: req.auth!.organizationId } },
    select: { id: true, hotelId: true }
  });
  if (!building) return res.status(404).json({ error: 'building_not_found' });
  if (!requireHotelScope(req, res, building.hotelId)) return;

  const floors = await prisma.floor.findMany({
    where: { buildingId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, nameOrNumber: true, sortOrder: true, notes: true, createdAt: true, updatedAt: true }
  });
  res.json({ floors });
});

router.post(
  '/buildings/:buildingId/floors',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const buildingId = String(req.params.buildingId || '').trim();
    const nameOrNumber = String(req.body?.nameOrNumber || '').trim();
    const sortOrder = parseOptionalNonNegativeInt(req.body?.sortOrder, 100000);
    const notes = req.body?.notes === undefined ? undefined : String(req.body.notes || '').trim();
    if (!buildingId) return res.status(400).json({ error: 'missing_building_id' });
    if (!nameOrNumber) return res.status(400).json({ error: 'missing_name_or_number' });

    const prisma = getPrisma();
    const building = await prisma.building.findFirst({
      where: { id: buildingId, hotel: { organizationId: req.auth!.organizationId } },
      select: { id: true }
    });
    if (!building) return res.status(404).json({ error: 'building_not_found' });

    const floor = await prisma.floor.create({
      data: { buildingId, nameOrNumber, ...(sortOrder !== undefined ? { sortOrder } : {}), ...(notes !== undefined ? { notes } : {}) },
      select: { id: true, nameOrNumber: true, sortOrder: true, notes: true, createdAt: true, updatedAt: true }
    });
    res.status(201).json({ floor });
  }
);

router.patch(
  '/floors/:floorId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const floorId = String(req.params.floorId || '').trim();
    const nameOrNumber = req.body?.nameOrNumber === undefined ? undefined : String(req.body.nameOrNumber || '').trim();
    const sortOrder = req.body?.sortOrder === undefined ? undefined : parseOptionalNonNegativeInt(req.body.sortOrder, 100000);
    const notes = req.body?.notes === undefined ? undefined : String(req.body.notes || '').trim();
    if (!floorId) return res.status(400).json({ error: 'missing_floor_id' });
    if (nameOrNumber !== undefined && !nameOrNumber) return res.status(400).json({ error: 'missing_name_or_number' });
    if (req.body?.sortOrder !== undefined && sortOrder === undefined) return res.status(400).json({ error: 'invalid_sort_order' });

    const prisma = getPrisma();
    const floor = await prisma.floor.findFirst({
      where: { id: floorId, building: { hotel: { organizationId: req.auth!.organizationId } } },
      select: { id: true }
    });
    if (!floor) return res.status(404).json({ error: 'floor_not_found' });

    const updated = await prisma.floor.update({
      where: { id: floorId },
      data: {
        ...(nameOrNumber !== undefined ? { nameOrNumber } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        ...(notes !== undefined ? { notes } : {})
      },
      select: { id: true, nameOrNumber: true, sortOrder: true, notes: true, createdAt: true, updatedAt: true }
    });
    res.json({ floor: updated });
  }
);

router.delete(
  '/floors/:floorId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const floorId = String(req.params.floorId || '').trim();
    if (!floorId) return res.status(400).json({ error: 'missing_floor_id' });

    const prisma = getPrisma();
    const floor = await prisma.floor.findFirst({
      where: { id: floorId, building: { hotel: { organizationId: req.auth!.organizationId } } },
      select: { id: true }
    });
    if (!floor) return res.status(404).json({ error: 'floor_not_found' });

    await prisma.floor.delete({ where: { id: floorId } });
    res.json({ ok: true });
  }
);

router.get('/floors/:floorId/rooms', requireAuth, async (req: AuthedRequest, res: Response) => {
  const floorId = String(req.params.floorId || '').trim();
  if (!floorId) return res.status(400).json({ error: 'missing_floor_id' });

  const prisma = getPrisma();
  const floor = await prisma.floor.findFirst({
    where: { id: floorId, building: { hotel: { organizationId: req.auth!.organizationId } } },
    select: { id: true, building: { select: { hotelId: true } } }
  });
  if (!floor) return res.status(404).json({ error: 'floor_not_found' });
  if (!requireHotelScope(req, res, floor.building.hotelId)) return;

  const rooms = await prisma.room.findMany({
    where: { floorId },
    orderBy: { roomNumber: 'asc' },
    select: {
      id: true,
      roomNumber: true,
      active: true,
      surface: true,
      sqft: true,
      cleaningFrequencyDays: true,
      lastCleanedAt: true,
      notes: true,
      createdAt: true,
      updatedAt: true
    }
  });
  res.json({
    rooms: rooms.map((r) => ({
      id: r.id,
      roomNumber: r.roomNumber,
      active: r.active,
      surface: r.surface,
      sqft: r.sqft,
      cleaningFrequency: r.cleaningFrequencyDays ?? null,
      lastCleaned: r.lastCleanedAt ? r.lastCleanedAt.getTime() : null,
      notes: r.notes || '',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }))
  });
});

router.post(
  '/floors/:floorId/rooms',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const floorId = String(req.params.floorId || '').trim();
    const roomNumber = String(req.body?.roomNumber || '').trim();
    const surface = String(req.body?.surface || 'BOTH').trim();
    const sqft = req.body?.sqft === undefined || req.body?.sqft === null ? null : Number(req.body.sqft);
    const cleaningFrequencyDays = parseOptionalPositiveInt(req.body?.cleaningFrequency, 5000);
    const lastCleanedAt = parseOptionalDate(req.body?.lastCleaned);
    const notes = req.body?.notes === undefined ? undefined : String(req.body.notes || '').trim();

    if (!floorId) return res.status(400).json({ error: 'missing_floor_id' });
    if (!roomNumber) return res.status(400).json({ error: 'missing_room_number' });
    if (!['CARPET', 'TILE', 'BOTH'].includes(surface)) return res.status(400).json({ error: 'invalid_surface' });
    if (sqft !== null && (!Number.isFinite(sqft) || sqft <= 0)) return res.status(400).json({ error: 'invalid_sqft' });
    if (req.body?.cleaningFrequency !== undefined && cleaningFrequencyDays === undefined) return res.status(400).json({ error: 'invalid_cleaning_frequency' });
    if (req.body?.lastCleaned !== undefined && lastCleanedAt === undefined) return res.status(400).json({ error: 'invalid_last_cleaned' });

    const prisma = getPrisma();
    const floor = await prisma.floor.findFirst({
      where: { id: floorId, building: { hotel: { organizationId: req.auth!.organizationId } } },
      select: { id: true }
    });
    if (!floor) return res.status(404).json({ error: 'floor_not_found' });

    const room = await prisma.room.create({
      data: {
        floorId,
        roomNumber,
        surface: surface as any,
        sqft: sqft === null ? undefined : sqft,
        ...(cleaningFrequencyDays !== undefined ? { cleaningFrequencyDays } : {}),
        ...(lastCleanedAt !== undefined ? { lastCleanedAt } : {}),
        ...(notes !== undefined ? { notes } : {})
      },
      select: {
        id: true,
        roomNumber: true,
        active: true,
        surface: true,
        sqft: true,
        cleaningFrequencyDays: true,
        lastCleanedAt: true,
        notes: true,
        createdAt: true,
        updatedAt: true
      }
    });
    res.status(201).json({
      room: {
        id: room.id,
        roomNumber: room.roomNumber,
        active: room.active,
        surface: room.surface,
        sqft: room.sqft,
        cleaningFrequency: room.cleaningFrequencyDays ?? null,
        lastCleaned: room.lastCleanedAt ? room.lastCleanedAt.getTime() : null,
        notes: room.notes || '',
        createdAt: room.createdAt,
        updatedAt: room.updatedAt
      }
    });
  }
);

router.post(
  '/floors/:floorId/rooms/bulk',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const floorId = String(req.params.floorId || '').trim();
    const start = Number(req.body?.start);
    const count = Number(req.body?.count);
    const prefix = req.body?.prefix === undefined || req.body?.prefix === null ? '' : String(req.body.prefix);
    const surface = String(req.body?.surface || 'BOTH').trim();
    const sqft = req.body?.sqft === undefined || req.body?.sqft === null ? null : Number(req.body.sqft);
    const cleaningFrequencyDays = parseOptionalPositiveInt(req.body?.cleaningFrequency, 5000);
    const lastCleanedAt = parseOptionalDate(req.body?.lastCleaned);
    const notes = req.body?.notes === undefined ? undefined : String(req.body.notes || '').trim();

    if (!floorId) return res.status(400).json({ error: 'missing_floor_id' });
    if (!Number.isFinite(start) || start <= 0) return res.status(400).json({ error: 'invalid_start' });
    if (!Number.isFinite(count) || count <= 0 || count > 500) return res.status(400).json({ error: 'invalid_count' });
    if (!['CARPET', 'TILE', 'BOTH'].includes(surface)) return res.status(400).json({ error: 'invalid_surface' });
    if (sqft !== null && (!Number.isFinite(sqft) || sqft <= 0)) return res.status(400).json({ error: 'invalid_sqft' });
    if (req.body?.cleaningFrequency !== undefined && cleaningFrequencyDays === undefined) return res.status(400).json({ error: 'invalid_cleaning_frequency' });
    if (req.body?.lastCleaned !== undefined && lastCleanedAt === undefined) return res.status(400).json({ error: 'invalid_last_cleaned' });

    const prisma = getPrisma();
    const floor = await prisma.floor.findFirst({
      where: { id: floorId, building: { hotel: { organizationId: req.auth!.organizationId } } },
      select: { id: true }
    });
    if (!floor) return res.status(404).json({ error: 'floor_not_found' });

    const rooms = Array.from({ length: count }, (_, i) => {
      const roomNumber = `${prefix}${start + i}`;
      return {
        floorId,
        roomNumber,
        surface: surface as any,
        sqft: sqft === null ? undefined : sqft,
        ...(cleaningFrequencyDays !== undefined ? { cleaningFrequencyDays } : {}),
        ...(lastCleanedAt !== undefined ? { lastCleanedAt } : {}),
        ...(notes !== undefined ? { notes } : {})
      };
    });

    // Skip duplicates quietly for now (idempotent-ish import)
    const result = await prisma.room.createMany({
      data: rooms,
      skipDuplicates: true
    });

    res.status(201).json({ createdCount: result.count });
  }
);

router.patch(
  '/rooms/:roomId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const roomId = String(req.params.roomId || '').trim();
    const roomNumber = req.body?.roomNumber === undefined ? undefined : String(req.body.roomNumber || '').trim();
    const active = req.body?.active === undefined ? undefined : Boolean(req.body.active);
    const surface = req.body?.surface === undefined ? undefined : String(req.body.surface || '').trim();
    const sqft = req.body?.sqft === undefined || req.body?.sqft === null ? undefined : Number(req.body.sqft);
    const cleaningFrequencyDays =
      req.body?.cleaningFrequency === undefined ? undefined : parseOptionalPositiveInt(req.body.cleaningFrequency, 5000);
    const lastCleanedAt = req.body?.lastCleaned === undefined ? undefined : parseOptionalDate(req.body.lastCleaned);
    const notes = req.body?.notes === undefined ? undefined : String(req.body.notes || '').trim();

    if (!roomId) return res.status(400).json({ error: 'missing_room_id' });
    if (roomNumber !== undefined && !roomNumber) return res.status(400).json({ error: 'missing_room_number' });
    if (surface !== undefined && !['CARPET', 'TILE', 'BOTH'].includes(surface))
      return res.status(400).json({ error: 'invalid_surface' });
    if (sqft !== undefined && (!Number.isFinite(sqft) || sqft <= 0)) return res.status(400).json({ error: 'invalid_sqft' });
    if (req.body?.cleaningFrequency !== undefined && cleaningFrequencyDays === undefined)
      return res.status(400).json({ error: 'invalid_cleaning_frequency' });
    if (req.body?.lastCleaned !== undefined && lastCleanedAt === undefined) return res.status(400).json({ error: 'invalid_last_cleaned' });

    const prisma = getPrisma();
    const room = await prisma.room.findFirst({
      where: { id: roomId, floor: { building: { hotel: { organizationId: req.auth!.organizationId } } } },
      select: { id: true }
    });
    if (!room) return res.status(404).json({ error: 'room_not_found' });

    const updated = await prisma.room.update({
      where: { id: roomId },
      data: {
        ...(roomNumber !== undefined ? { roomNumber } : {}),
        ...(active !== undefined ? { active } : {}),
        ...(surface !== undefined ? { surface: surface as any } : {}),
        ...(sqft !== undefined ? { sqft } : {}),
        ...(cleaningFrequencyDays !== undefined ? { cleaningFrequencyDays } : {}),
        ...(lastCleanedAt !== undefined ? { lastCleanedAt } : {}),
        ...(notes !== undefined ? { notes } : {})
      },
      select: {
        id: true,
        roomNumber: true,
        active: true,
        surface: true,
        sqft: true,
        cleaningFrequencyDays: true,
        lastCleanedAt: true,
        notes: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({
      room: {
        id: updated.id,
        roomNumber: updated.roomNumber,
        active: updated.active,
        surface: updated.surface,
        sqft: updated.sqft,
        cleaningFrequency: updated.cleaningFrequencyDays ?? null,
        lastCleaned: updated.lastCleanedAt ? updated.lastCleanedAt.getTime() : null,
        notes: updated.notes || '',
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt
      }
    });
  }
);

router.delete(
  '/rooms/:roomId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const roomId = String(req.params.roomId || '').trim();
    if (!roomId) return res.status(400).json({ error: 'missing_room_id' });

    const prisma = getPrisma();
    const room = await prisma.room.findFirst({
      where: { id: roomId, floor: { building: { hotel: { organizationId: req.auth!.organizationId } } } },
      select: { id: true }
    });
    if (!room) return res.status(404).json({ error: 'room_not_found' });

    await prisma.room.delete({ where: { id: roomId } });
    res.json({ ok: true });
  }
);

router.get('/floors/:floorId/spaces', requireAuth, async (req: AuthedRequest, res: Response) => {
  const floorId = String(req.params.floorId || '').trim();
  if (!floorId) return res.status(400).json({ error: 'missing_floor_id' });

  const prisma = getPrisma();
  const floor = await prisma.floor.findFirst({
    where: { id: floorId, building: { hotel: { organizationId: req.auth!.organizationId } } },
    select: { id: true, building: { select: { hotelId: true } } }
  });
  if (!floor) return res.status(404).json({ error: 'floor_not_found' });
  if (!requireHotelScope(req, res, floor.building.hotelId)) return;

  const spaces = await prisma.space.findMany({
    where: { floorId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, type: true, active: true, sqft: true, cleaningFrequencyDays: true, createdAt: true, updatedAt: true }
  });
  res.json({
    spaces: spaces.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      active: s.active,
      sqft: s.sqft,
      cleaningFrequency: s.cleaningFrequencyDays ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    }))
  });
});

router.post(
  '/floors/:floorId/spaces',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const floorId = String(req.params.floorId || '').trim();
    const name = String(req.body?.name || '').trim();
    const type = req.body?.type === undefined ? undefined : String(req.body.type || '').trim();
    const sqft = req.body?.sqft === undefined || req.body?.sqft === null ? null : Number(req.body.sqft);
    const cleaningFrequencyDays = parseOptionalPositiveInt(req.body?.cleaningFrequency, 5000);

    if (!floorId) return res.status(400).json({ error: 'missing_floor_id' });
    if (!name) return res.status(400).json({ error: 'missing_name' });
    if (type !== undefined && !type) return res.status(400).json({ error: 'missing_type' });
    if (sqft !== null && (!Number.isFinite(sqft) || sqft <= 0)) return res.status(400).json({ error: 'invalid_sqft' });
    if (req.body?.cleaningFrequency !== undefined && cleaningFrequencyDays === undefined) return res.status(400).json({ error: 'invalid_cleaning_frequency' });

    const prisma = getPrisma();
    const floor = await prisma.floor.findFirst({
      where: { id: floorId, building: { hotel: { organizationId: req.auth!.organizationId } } },
      select: { id: true }
    });
    if (!floor) return res.status(404).json({ error: 'floor_not_found' });

    const space = await prisma.space.create({
      data: {
        floorId,
        name,
        sqft: sqft === null ? undefined : sqft,
        ...(type !== undefined ? { type } : {}),
        ...(cleaningFrequencyDays !== undefined ? { cleaningFrequencyDays } : {})
      },
      select: { id: true, name: true, type: true, active: true, sqft: true, cleaningFrequencyDays: true, createdAt: true, updatedAt: true }
    });
    res.status(201).json({
      space: {
        id: space.id,
        name: space.name,
        type: space.type,
        active: space.active,
        sqft: space.sqft,
        cleaningFrequency: space.cleaningFrequencyDays ?? null,
        createdAt: space.createdAt,
        updatedAt: space.updatedAt
      }
    });
  }
);

router.patch(
  '/spaces/:spaceId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const spaceId = String(req.params.spaceId || '').trim();
    const name = req.body?.name === undefined ? undefined : String(req.body.name || '').trim();
    const type = req.body?.type === undefined ? undefined : String(req.body.type || '').trim();
    const active = req.body?.active === undefined ? undefined : Boolean(req.body.active);
    const sqft = req.body?.sqft === undefined || req.body?.sqft === null ? undefined : Number(req.body.sqft);
    const cleaningFrequencyDays =
      req.body?.cleaningFrequency === undefined ? undefined : parseOptionalPositiveInt(req.body.cleaningFrequency, 5000);

    if (!spaceId) return res.status(400).json({ error: 'missing_space_id' });
    if (name !== undefined && !name) return res.status(400).json({ error: 'missing_name' });
    if (type !== undefined && !type) return res.status(400).json({ error: 'missing_type' });
    if (sqft !== undefined && (!Number.isFinite(sqft) || sqft <= 0)) return res.status(400).json({ error: 'invalid_sqft' });
    if (req.body?.cleaningFrequency !== undefined && cleaningFrequencyDays === undefined)
      return res.status(400).json({ error: 'invalid_cleaning_frequency' });

    const prisma = getPrisma();
    const space = await prisma.space.findFirst({
      where: { id: spaceId, floor: { building: { hotel: { organizationId: req.auth!.organizationId } } } },
      select: { id: true }
    });
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    const updated = await prisma.space.update({
      where: { id: spaceId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(active !== undefined ? { active } : {}),
        ...(sqft !== undefined ? { sqft } : {}),
        ...(cleaningFrequencyDays !== undefined ? { cleaningFrequencyDays } : {})
      },
      select: { id: true, name: true, type: true, active: true, sqft: true, cleaningFrequencyDays: true, createdAt: true, updatedAt: true }
    });

    res.json({
      space: {
        id: updated.id,
        name: updated.name,
        type: updated.type,
        active: updated.active,
        sqft: updated.sqft,
        cleaningFrequency: updated.cleaningFrequencyDays ?? null,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt
      }
    });
  }
);

router.delete(
  '/spaces/:spaceId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const spaceId = String(req.params.spaceId || '').trim();
    if (!spaceId) return res.status(400).json({ error: 'missing_space_id' });

    const prisma = getPrisma();
    const space = await prisma.space.findFirst({
      where: { id: spaceId, floor: { building: { hotel: { organizationId: req.auth!.organizationId } } } },
      select: { id: true }
    });
    if (!space) return res.status(404).json({ error: 'space_not_found' });

    await prisma.space.delete({ where: { id: spaceId } });
    res.json({ ok: true });
  }
);

export default router;
