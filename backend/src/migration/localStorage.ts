import { type PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

export type LocalStorageExport = any;

export async function backfillLegacyIds(prisma: PrismaClient, organizationId: string) {
  // For safe idempotent import/export we ensure legacyId is set for rows created via API.
  await prisma.$executeRaw`UPDATE "Hotel" SET "legacyId"="id" WHERE "organizationId"=${organizationId} AND "legacyId" IS NULL;`;
  await prisma.$executeRaw`UPDATE "Building" SET "legacyId"="id" WHERE "legacyId" IS NULL;`;
  await prisma.$executeRaw`UPDATE "Floor" SET "legacyId"="id" WHERE "legacyId" IS NULL;`;
  await prisma.$executeRaw`UPDATE "Room" SET "legacyId"="id" WHERE "legacyId" IS NULL;`;
  await prisma.$executeRaw`UPDATE "Space" SET "legacyId"="id" WHERE "legacyId" IS NULL;`;
  await prisma.$executeRaw`UPDATE "StaffMember" SET "legacyId"="id" WHERE "organizationId"=${organizationId} AND "legacyId" IS NULL;`;
  await prisma.$executeRaw`UPDATE "Task" SET "legacyId"="id" WHERE "organizationId"=${organizationId} AND "legacyId" IS NULL;`;
  await prisma.$executeRaw`UPDATE "Technician" SET "legacyId"="id" WHERE "organizationId"=${organizationId} AND "legacyId" IS NULL;`;
  await prisma.$executeRaw`UPDATE "Session" SET "legacyId"="id" WHERE "organizationId"=${organizationId} AND "legacyId" IS NULL;`;
  await prisma.$executeRaw`UPDATE "BlockedSlot" SET "legacyId"="id" WHERE "organizationId"=${organizationId} AND "legacyId" IS NULL;`;
  await prisma.$executeRaw`UPDATE "Contract" SET "legacyId"="id" WHERE "organizationId"=${organizationId} AND "legacyId" IS NULL;`;
}

function asStringId(v: any): string {
  return String(v || '').trim();
}

function mapId(id: string | null | undefined, map: Map<string, string>) {
  if (!id) return null;
  return map.get(id) || null;
}

function remapObjectKeys(obj: any, keyMap: Map<string, string>) {
  const out: any = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const nk = keyMap.get(String(k)) || null;
    if (nk) out[nk] = v;
  }
  return out;
}

function toIsoDate(value: any): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function toDateFromEpochOrIso(value: any): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return null;
    return d;
  }
  const d = new Date(String(value));
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function normalizeTaskStatus(status: any): 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED' {
  const v = String(status || '').trim().toUpperCase();
  if (v === 'OPEN' || v === 'IN_PROGRESS' || v === 'BLOCKED' || v === 'DONE' || v === 'CANCELLED') return v as any;
  return 'OPEN';
}

function normalizeTaskPriority(priority: any): 'NORMAL' | 'HIGH' | 'URGENT' {
  const v = String(priority || '').trim().toUpperCase();
  if (v === 'URGENT') return 'URGENT';
  if (v === 'HIGH') return 'HIGH';
  return 'NORMAL';
}

function normalizeReservationStatus(status: any): 'PROPOSED' | 'PENDING' | 'APPROVED' | 'CANCELLED' {
  const v = String(status || '').trim().toUpperCase();
  if (v === 'PROPOSED' || v === 'PENDING' || v === 'APPROVED' || v === 'CANCELLED') return v as any;
  return 'PENDING';
}

export async function exportLocalStorage(prisma: PrismaClient, organizationId: string, userId: string): Promise<LocalStorageExport> {
  await backfillLegacyIds(prisma, organizationId);

  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true, activeHotelId: true, hotelScopeId: true, role: true }
  });
  const hotelScopeId = user?.role === 'SUPER_ADMIN' ? null : (user?.hotelScopeId || null);

  const hotels = await prisma.hotel.findMany({
    where: { organizationId, ...(hotelScopeId ? { id: hotelScopeId } : {}) },
    include: {
      buildings: {
        include: {
          floors: {
            include: {
              rooms: true,
              spaces: true
            }
          }
        }
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  const hotelIdMap = new Map<string, string>();
  const roomIdMap = new Map<string, string>();
  const spaceIdMap = new Map<string, string>();

  const hotelsObj: any = {};
  for (const h of hotels) {
    const hid = h.legacyId || h.id;
    hotelIdMap.set(h.id, hid);
    const buildings = (h.buildings || []).map((b) => {
      const bid = (b as any).legacyId || b.id;
      const floors = (b.floors || []).map((f) => {
        const fid = (f as any).legacyId || f.id;
        const rooms = (f.rooms || []).map((r) => {
          const rid = (r as any).legacyId || r.id;
          roomIdMap.set(r.id, rid);
          return {
            id: rid,
            roomNumber: r.roomNumber,
            active: r.active,
            surface: r.surface,
            sqft: r.sqft,
            lastCleaned: (r as any).lastCleanedAt ? new Date((r as any).lastCleanedAt).getTime() : null,
            cleaningFrequency: (r as any).cleaningFrequencyDays ?? null,
            notes: (r as any).notes || ''
          };
        });
        const spaces = (f.spaces || []).map((s) => {
          const sid = (s as any).legacyId || s.id;
          spaceIdMap.set(s.id, sid);
          return {
            id: sid,
            name: s.name,
            type: (s as any).type || 'CORRIDOR',
            active: s.active,
            sqft: s.sqft,
            cleaningFrequency: (s as any).cleaningFrequencyDays ?? null
          };
        });
        return { id: fid, nameOrNumber: f.nameOrNumber, sortOrder: (f as any).sortOrder ?? null, notes: (f as any).notes || '', rooms, spaces };
      });
      return { id: bid, name: b.name, notes: (b as any).notes || '', floors };
    });

    hotelsObj[hid] = { id: hid, name: h.name, buildings };
  }

  const staff = await prisma.staffMember.findMany({
    where: { organizationId, ...(hotelScopeId ? { hotelId: hotelScopeId } : {}) },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
  });
  const staffIdMap = new Map<string, string>();
  const staffObj: any = {};
  for (const m of staff) {
    const sid = (m as any).legacyId || m.id;
    staffIdMap.set(m.id, sid);
    staffObj[sid] = {
      id: sid,
      token: m.token,
      hotelId: hotelIdMap.get(m.hotelId) || m.hotelId,
      firstName: m.firstName,
      lastName: m.lastName,
      phone: m.phone,
      notes: m.notes,
      active: m.active,
      createdAt: m.createdAt.toISOString()
    };
  }

  const tasks = await prisma.task.findMany({
    where: { organizationId, ...(hotelScopeId ? { hotelId: hotelScopeId } : {}) },
    orderBy: { createdAt: 'asc' },
    include: {
      locations: true,
      events: { orderBy: { at: 'asc' } },
      attachments: { orderBy: { at: 'asc' } }
    }
  });
  const tasksObj: any = {};
  for (const t of tasks) {
    const tid = (t as any).legacyId || t.id;
    const locations = (t.locations || []).map((l: any) => ({
      label: String(l.label || '').trim(),
      roomId: mapId(l.roomId, roomIdMap),
      spaceId: mapId(l.spaceId, spaceIdMap)
    }));
    const locationPreview = locations.map((l: any) => l?.label).filter(Boolean).slice(0, 3).join(', ');
    const location = { label: locationPreview || locations[0]?.label || '' };

    const attachments = (t.attachments || []).map((a: any) => ({
      id: a.id,
      at: a.at.toISOString(),
      name: a.name,
      mime: a.mime,
      dataUrl: a.dataUrl || null,
      url: a.storagePath ? `/api/v1/tasks/${t.id}/attachments/${a.id}/file` : null,
      actorRole: a.actorRole,
      actorStaffId: a.actorStaffId ? staffIdMap.get(a.actorStaffId) || a.actorStaffId : null
    }));

    tasksObj[tid] = {
      id: tid,
      hotelId: hotelIdMap.get(t.hotelId) || t.hotelId,
      category: t.category,
      status: t.status,
      type: t.type,
      priority: t.priority,
      locations,
      location,
      room: location.label,
      description: t.description,
      assignedStaffId: t.assignedStaffId ? staffIdMap.get(t.assignedStaffId) || t.assignedStaffId : null,
      schedule: t.schedule || null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      events: (t.events || []).map((e: any) => ({
        id: e.id,
        at: e.at.toISOString(),
        action: e.action,
        actorRole: e.actorRole,
        actorStaffId: e.actorStaffId ? staffIdMap.get(e.actorStaffId) || e.actorStaffId : null,
        note: e.note,
        patch: e.patch || null
      })),
      attachments
    };
  }

  const reservations = await prisma.reservation.findMany({
    where: { organizationId, ...(hotelScopeId ? { hotelId: hotelScopeId } : {}) },
    orderBy: { createdAt: 'asc' }
  });
  const reservationsObj: any = {};
  for (const r of reservations) {
    reservationsObj[r.id] = {
      id: r.id,
      token: r.token,
      statusAdmin: r.statusAdmin,
      statusHotel: r.statusHotel,
      createdAt: r.createdAt.toISOString(),
      confirmedAt: r.confirmedAt?.toISOString() || null,
      cancelledAt: r.cancelledAt?.toISOString() || null,
      cancelledBy: r.cancelledBy || '',
      cancelReason: r.cancelReason || '',
      requiresAdminApproval: r.requiresAdminApproval,
      hotelId: hotelIdMap.get(r.hotelId) || r.hotelId,
      roomIds: (Array.isArray(r.roomIds) ? r.roomIds : []).map((id: any) => roomIdMap.get(String(id)) || String(id)),
      spaceIds: (Array.isArray(r.spaceIds) ? r.spaceIds : []).map((id: any) => spaceIdMap.get(String(id)) || String(id)),
      roomNotes: remapObjectKeys(r.roomNotes, roomIdMap),
      spaceNotes: remapObjectKeys(r.spaceNotes, spaceIdMap),
      surfaceDefault: r.surfaceDefault,
      roomSurfaceOverrides: remapObjectKeys(r.roomSurfaceOverrides, roomIdMap),
      notesGlobal: r.notesGlobal,
      notesOrg: r.notesOrg,
      durationMinutes: r.durationMinutes,
      proposedDate: r.proposedDate,
      proposedStart: r.proposedStart
    };
  }

  const sessions = await prisma.session.findMany({
    where: { organizationId, ...(hotelScopeId ? { hotelId: hotelScopeId } : {}) },
    orderBy: { createdAt: 'asc' }
  });
  const sessionsObj: any = {};
  for (const s of sessions) {
    const sid = (s as any).legacyId || s.id;
    sessionsObj[sid] = {
      id: sid,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
      hotelId: hotelIdMap.get(s.hotelId) || s.hotelId,
      roomIds: (Array.isArray(s.roomIds) ? s.roomIds : []).map((id: any) => roomIdMap.get(String(id)) || String(id)),
      date: s.date,
      start: s.start,
      end: s.end,
      technicianId: s.technicianId || ''
    };
  }

  const technicians = await prisma.technician.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
  const techniciansObj: any = {};
  if (!hotelScopeId) {
    for (const t of technicians) {
      const tid = (t as any).legacyId || t.id;
      techniciansObj[tid] = {
        id: tid,
        name: t.name,
        phone: t.phone,
        notes: t.notes,
        active: t.active,
        createdAt: t.createdAt.toISOString()
      };
    }
  }

  const blockedSlots = await prisma.blockedSlot.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
  const blockedArr = hotelScopeId
    ? []
    : blockedSlots.map((b: any) => ({
        id: b.legacyId || b.id,
        date: b.date,
        start: b.start,
        end: b.end,
        note: b.note,
        createdAt: b.createdAt.toISOString()
      }));

  const contracts = await prisma.contract.findMany({
    where: { organizationId, ...(hotelScopeId ? { hotelId: hotelScopeId } : {}) },
    orderBy: { sentAt: 'asc' }
  });
  const contractsObj: any = {};
  for (const c of contracts) {
    const cid = (c as any).legacyId || c.id;
    contractsObj[cid] = {
      id: cid,
      token: c.token,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      hotelId: hotelIdMap.get(c.hotelId) || c.hotelId,
      hotelName: c.hotelName,
      contact: c.contact,
      pricing: c.pricing,
      roomsMinPerSession: c.roomsMinPerSession,
      roomsMaxPerSession: c.roomsMaxPerSession,
      roomsPerSession: c.roomsPerSession,
      frequency: c.frequency,
      surfaceType: c.surfaceType,
      appliedTier: c.appliedTier,
      appliedPricePerRoom: c.appliedPricePerRoom,
      otherSurfaces: c.otherSurfaces,
      totalPerSession: c.totalPerSession,
      notes: c.notes,
      sentAt: c.sentAt.toISOString(),
      signedBy: c.signedBy,
      acceptedAt: c.acceptedAt?.toISOString() || null
    };
  }

  const pricingDefaults = await prisma.pricingDefaults.findUnique({ where: { organizationId } });

  const activeHotelId =
    hotelScopeId
      ? (hotels.length ? (hotels[0].legacyId || hotels[0].id) : null)
      : (user?.activeHotelId ? hotelIdMap.get(user.activeHotelId) : null) ||
        (hotels.length ? (hotels[0].legacyId || hotels[0].id) : null);

  return {
    version: 1,
    activeHotelId,
    hotels: hotelsObj,
    contracts: contractsObj,
    sessions: sessionsObj,
    reservations: reservationsObj,
    incidents: {},
    tasks: tasksObj,
    staff: staffObj,
    technicians: techniciansObj,
    availability: { blocked: blockedArr },
    settings: {
      timezone: 'America/New_York',
      workHours: { start: '08:00', end: '17:00' }
    },
    pricing: { defaults: pricingDefaults ? {
      roomsMinPerSession: pricingDefaults.roomsMinPerSession,
      roomsMaxPerSession: pricingDefaults.roomsMaxPerSession,
      basePrices: pricingDefaults.basePrices,
      penaltyPrices: pricingDefaults.penaltyPrices,
      contractPrices: pricingDefaults.contractPrices,
      advantagePrices: pricingDefaults.advantagePrices,
      sqftPrices: pricingDefaults.sqftPrices
    } : undefined },
    updatedAt: new Date().toISOString()
  };
}

export type ImportSummary = { created: Record<string, number>; skipped: Record<string, number> };

export async function importLocalStorage(prisma: PrismaClient, organizationId: string, userId: string, payload: any): Promise<ImportSummary> {
  await backfillLegacyIds(prisma, organizationId);

  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true, role: true, hotelScopeId: true }
  });
  const hotelScopeId = user?.role === 'SUPER_ADMIN' ? null : (user?.hotelScopeId || null);
  const scopedHotel = hotelScopeId
    ? await prisma.hotel.findFirst({ where: { id: hotelScopeId, organizationId }, select: { id: true, legacyId: true } })
    : null;
  const allowedHotelLegacyIds = scopedHotel ? new Set([scopedHotel.id, scopedHotel.legacyId].filter(Boolean)) : null;

  const hotels = payload?.hotels && typeof payload.hotels === 'object' ? payload.hotels : {};
  const staffMap = payload?.staff && typeof payload.staff === 'object' ? payload.staff : {};
  const tasksMap = payload?.tasks && typeof payload.tasks === 'object' ? payload.tasks : {};
  const reservationsMap = payload?.reservations && typeof payload.reservations === 'object' ? payload.reservations : {};
  const sessionsMap = payload?.sessions && typeof payload.sessions === 'object' ? payload.sessions : {};
  const techniciansMap = payload?.technicians && typeof payload.technicians === 'object' ? payload.technicians : {};
  const blocked = Array.isArray(payload?.availability?.blocked) ? payload.availability.blocked : [];
  const contractsMap = payload?.contracts && typeof payload.contracts === 'object' ? payload.contracts : {};
  const pricingDefaults = payload?.pricing?.defaults ?? null;

  const created: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const bump = (bucket: Record<string, number>, key: string, n = 1) => (bucket[key] = (bucket[key] || 0) + n);

  const hotelIdMap = new Map<string, string>(); // legacy -> db id
  const buildingIdMap = new Map<string, string>();
  const floorIdMap = new Map<string, string>();
  const roomIdMap = new Map<string, string>();
  const spaceIdMap = new Map<string, string>();
  const staffIdMap = new Map<string, string>();
  const technicianIdMap = new Map<string, string>();

  // Hotels + structure
  for (const [legacyHotelId, hotel] of Object.entries(hotels)) {
    if (allowedHotelLegacyIds && !allowedHotelLegacyIds.has(legacyHotelId)) {
      bump(skipped, 'hotels_out_of_scope');
      continue;
    }
    const name = asStringId((hotel as any)?.name);
    if (!name) continue;

    const dbHotel = scopedHotel
      ? await prisma.hotel.update({ where: { id: scopedHotel.id }, data: { name } })
      : await prisma.hotel.upsert({
          where: { organizationId_legacyId: { organizationId, legacyId: legacyHotelId } },
          create: { organizationId, legacyId: legacyHotelId, name },
          update: { name }
        });
    hotelIdMap.set(legacyHotelId, dbHotel.id);
    bump(created, 'hotels');

    const buildings = Array.isArray((hotel as any)?.buildings) ? (hotel as any).buildings : [];
    for (const b of buildings) {
      const legacyBuildingId = asStringId(b?.id);
      const bName = asStringId(b?.name);
      if (!legacyBuildingId || !bName) continue;

      const dbBuilding = await prisma.building.upsert({
        where: { hotelId_legacyId: { hotelId: dbHotel.id, legacyId: legacyBuildingId } },
        create: { hotelId: dbHotel.id, legacyId: legacyBuildingId, name: bName, notes: asStringId(b?.notes) },
        update: { name: bName, notes: asStringId(b?.notes) }
      });
      buildingIdMap.set(legacyBuildingId, dbBuilding.id);
      bump(created, 'buildings');

      const floors = Array.isArray(b?.floors) ? b.floors : [];
      for (const f of floors) {
        const legacyFloorId = asStringId(f?.id);
        const nameOrNumber = asStringId(f?.nameOrNumber);
        if (!legacyFloorId || !nameOrNumber) continue;

        const sortOrder = f?.sortOrder == null ? undefined : Number(f.sortOrder);
        const notes = asStringId(f?.notes);

        const dbFloor = await prisma.floor.upsert({
          where: { buildingId_legacyId: { buildingId: dbBuilding.id, legacyId: legacyFloorId } },
          create: {
            buildingId: dbBuilding.id,
            legacyId: legacyFloorId,
            nameOrNumber,
            ...(sortOrder !== undefined && Number.isFinite(sortOrder) ? { sortOrder: Math.floor(sortOrder) } : {}),
            ...(notes ? { notes } : {})
          },
          update: {
            nameOrNumber,
            ...(sortOrder !== undefined && Number.isFinite(sortOrder) ? { sortOrder: Math.floor(sortOrder) } : {}),
            ...(notes ? { notes } : {})
          }
        });
        floorIdMap.set(legacyFloorId, dbFloor.id);
        bump(created, 'floors');

        const rooms = Array.isArray(f?.rooms) ? f.rooms : [];
        for (const r of rooms) {
          const legacyRoomId = asStringId(r?.id);
          const roomNumber = asStringId(r?.roomNumber);
          if (!legacyRoomId || !roomNumber) continue;

          const cleaningFrequencyDays = r?.cleaningFrequency == null ? undefined : Number(r.cleaningFrequency);
          const lastCleanedAt = toDateFromEpochOrIso(r?.lastCleaned) || undefined;
          const notes = asStringId(r?.notes);

          const dbRoom = await prisma.room.upsert({
            where: { floorId_legacyId: { floorId: dbFloor.id, legacyId: legacyRoomId } },
            create: {
              floorId: dbFloor.id,
              legacyId: legacyRoomId,
              roomNumber,
              active: r?.active !== false,
              surface: String(r?.surface || 'BOTH').toUpperCase() as any,
              sqft: r?.sqft != null ? Number(r.sqft) : undefined,
              ...(cleaningFrequencyDays !== undefined && Number.isFinite(cleaningFrequencyDays)
                ? { cleaningFrequencyDays: Math.floor(cleaningFrequencyDays) }
                : {}),
              ...(lastCleanedAt ? { lastCleanedAt } : {}),
              ...(notes ? { notes } : {})
            },
            update: {
              roomNumber,
              active: r?.active !== false,
              surface: String(r?.surface || 'BOTH').toUpperCase() as any,
              sqft: r?.sqft != null ? Number(r.sqft) : undefined,
              ...(cleaningFrequencyDays !== undefined && Number.isFinite(cleaningFrequencyDays)
                ? { cleaningFrequencyDays: Math.floor(cleaningFrequencyDays) }
                : {}),
              ...(lastCleanedAt ? { lastCleanedAt } : {}),
              ...(notes ? { notes } : {})
            }
          });
          roomIdMap.set(legacyRoomId, dbRoom.id);
          bump(created, 'rooms');
        }

        const spaces = Array.isArray(f?.spaces) ? f.spaces : [];
        for (const s of spaces) {
          const legacySpaceId = asStringId(s?.id);
          const sName = asStringId(s?.name);
          if (!legacySpaceId || !sName) continue;

          const type = asStringId(s?.type) || 'CORRIDOR';
          const cleaningFrequencyDays = s?.cleaningFrequency == null ? undefined : Number(s.cleaningFrequency);

          const dbSpace = await prisma.space.upsert({
            where: { floorId_legacyId: { floorId: dbFloor.id, legacyId: legacySpaceId } },
            create: {
              floorId: dbFloor.id,
              legacyId: legacySpaceId,
              name: sName,
              type,
              active: s?.active !== false,
              sqft: s?.sqft != null ? Number(s.sqft) : undefined,
              ...(cleaningFrequencyDays !== undefined && Number.isFinite(cleaningFrequencyDays)
                ? { cleaningFrequencyDays: Math.floor(cleaningFrequencyDays) }
                : {})
            },
            update: {
              name: sName,
              type,
              active: s?.active !== false,
              sqft: s?.sqft != null ? Number(s.sqft) : undefined,
              ...(cleaningFrequencyDays !== undefined && Number.isFinite(cleaningFrequencyDays)
                ? { cleaningFrequencyDays: Math.floor(cleaningFrequencyDays) }
                : {})
            }
          });
          spaceIdMap.set(legacySpaceId, dbSpace.id);
          bump(created, 'spaces');
        }
      }
    }
  }

  // Persist user's active hotel selection (legacy id → db id)
  if (scopedHotel) {
    await prisma.user.updateMany({
      where: { id: userId, organizationId },
      data: { activeHotelId: scopedHotel.id }
    });
  } else {
    const desiredActiveLegacy = asStringId(payload?.activeHotelId);
    const desiredActiveDbId = desiredActiveLegacy ? hotelIdMap.get(desiredActiveLegacy) || null : null;
    if (desiredActiveDbId) {
      await prisma.user.updateMany({
        where: { id: userId, organizationId },
        data: { activeHotelId: desiredActiveDbId }
      });
    }
  }

  // Staff
  for (const [legacyStaffId, member] of Object.entries(staffMap)) {
    const legacyHotelId = asStringId((member as any)?.hotelId);
    const hotelId = hotelIdMap.get(legacyHotelId);
    if (!hotelId) {
      bump(skipped, 'staff_missing_hotel');
      continue;
    }

    const existing = await prisma.staffMember.findUnique({
      where: { organizationId_legacyId: { organizationId, legacyId: legacyStaffId } },
      select: { id: true }
    });
    if (existing) {
      staffIdMap.set(legacyStaffId, existing.id);
      bump(skipped, 'staff');
      continue;
    }

    const token = asStringId((member as any)?.token) || `stafftok_${randomBytes(12).toString('hex')}`;
    const safeToken = (await prisma.staffMember.findUnique({ where: { token }, select: { id: true } })) ? `stafftok_${randomBytes(12).toString('hex')}` : token;

    const createdMember = await prisma.staffMember.create({
      data: {
        organizationId,
        hotelId,
        legacyId: legacyStaffId,
        token: safeToken,
        firstName: asStringId((member as any)?.firstName),
        lastName: asStringId((member as any)?.lastName),
        phone: asStringId((member as any)?.phone),
        notes: asStringId((member as any)?.notes),
        active: (member as any)?.active !== false
      },
      select: { id: true }
    });
    staffIdMap.set(legacyStaffId, createdMember.id);
    bump(created, 'staff');
  }

  // Technicians
  if (!hotelScopeId)
  for (const [legacyTechId, tech] of Object.entries(techniciansMap)) {
    const existing = await prisma.technician.findUnique({
      where: { organizationId_legacyId: { organizationId, legacyId: legacyTechId } },
      select: { id: true }
    });
    if (existing) {
      technicianIdMap.set(legacyTechId, existing.id);
      bump(skipped, 'technicians');
      continue;
    }
    const createdTech = await prisma.technician.create({
      data: {
        organizationId,
        legacyId: legacyTechId,
        name: asStringId((tech as any)?.name) || 'Technician',
        phone: asStringId((tech as any)?.phone),
        notes: asStringId((tech as any)?.notes),
        active: (tech as any)?.active !== false
      },
      select: { id: true }
    });
    technicianIdMap.set(legacyTechId, createdTech.id);
    bump(created, 'technicians');
  }

  // Blocked slots
  if (!hotelScopeId)
  for (const slot of blocked) {
    const legacyId = asStringId(slot?.id);
    if (!legacyId) continue;

    const existing = await prisma.blockedSlot.findUnique({
      where: { organizationId_legacyId: { organizationId, legacyId } },
      select: { id: true }
    });
    if (existing) {
      bump(skipped, 'blocked_slots');
      continue;
    }
    await prisma.blockedSlot.create({
      data: {
        organizationId,
        legacyId,
        date: asStringId(slot?.date),
        start: asStringId(slot?.start),
        end: asStringId(slot?.end),
        note: asStringId(slot?.note)
      }
    });
    bump(created, 'blocked_slots');
  }

  // Sessions
  for (const [legacySessionId, s] of Object.entries(sessionsMap)) {
    const legacyHotelId = asStringId((s as any)?.hotelId);
    const hotelId = hotelIdMap.get(legacyHotelId);
    if (!hotelId) {
      bump(skipped, 'sessions_missing_hotel');
      continue;
    }

    const existing = await prisma.session.findUnique({
      where: { organizationId_legacyId: { organizationId, legacyId: legacySessionId } },
      select: { id: true }
    });
    if (existing) {
      bump(skipped, 'sessions');
      continue;
    }

    const legacyRoomIds = Array.isArray((s as any)?.roomIds) ? (s as any).roomIds : [];
    const roomIds = legacyRoomIds
      .map((rid: any): string | undefined => roomIdMap.get(asStringId(rid)))
      .filter((value: string | undefined): value is string => Boolean(value));

    const legacyTechId = asStringId((s as any)?.technicianId);
    const technicianId = legacyTechId ? technicianIdMap.get(legacyTechId) : undefined;

    await prisma.session.create({
      data: {
        organizationId,
        hotelId,
        legacyId: legacySessionId,
        roomIds,
        date: asStringId((s as any)?.date),
        start: asStringId((s as any)?.start),
        end: asStringId((s as any)?.end),
        technicianId
      }
    });
    bump(created, 'sessions');
  }

  // Tasks (includes incidents)
  for (const [legacyTaskId, t] of Object.entries(tasksMap)) {
    const legacyHotelId = asStringId((t as any)?.hotelId);
    const hotelId = hotelIdMap.get(legacyHotelId);
    if (!hotelId) {
      bump(skipped, 'tasks_missing_hotel');
      continue;
    }

    const exists = await prisma.task.findUnique({
      where: { organizationId_legacyId: { organizationId, legacyId: legacyTaskId } },
      select: { id: true }
    });
    if (exists) {
      bump(skipped, 'tasks');
      continue;
    }

    const assignedLegacy = asStringId((t as any)?.assignedStaffId);
    const assignedStaffId = assignedLegacy ? staffIdMap.get(assignedLegacy) : undefined;

    const createdAt = toIsoDate((t as any)?.createdAt) || new Date();
    const updatedAt = toIsoDate((t as any)?.updatedAt) || createdAt;

    const category = String((t as any)?.category || 'TASK').trim().toUpperCase() === 'INCIDENT' ? 'INCIDENT' : 'TASK';
    const status = normalizeTaskStatus((t as any)?.status);
    const priority = normalizeTaskPriority((t as any)?.priority);
    const type = asStringId((t as any)?.type) || 'OTHER';
    const description = asStringId((t as any)?.description);

    const locations = Array.isArray((t as any)?.locations)
      ? (t as any).locations
      : (t as any)?.location
        ? [(t as any).location]
        : [];

    const events = Array.isArray((t as any)?.events) ? (t as any).events : [];
    const attachments = Array.isArray((t as any)?.attachments) ? (t as any).attachments : [];

    await prisma.task.create({
      data: {
        organizationId,
        hotelId,
        legacyId: legacyTaskId,
        category: category as any,
        status: status as any,
        priority: priority as any,
        type,
        description,
        assignedStaffId,
        schedule: (t as any)?.schedule ?? undefined,
        createdAt,
        updatedAt,
        locations: {
          create: locations.map((l: any) => ({
            label: asStringId(l?.label),
            roomId: l?.roomId ? roomIdMap.get(asStringId(l.roomId)) : undefined,
            spaceId: l?.spaceId ? spaceIdMap.get(asStringId(l.spaceId)) : undefined
          }))
        },
        events: {
          create: events.map((e: any) => ({
            at: toIsoDate(e?.at) || new Date(),
            action: asStringId(e?.action) || 'NOTE',
            actorRole: asStringId(e?.actorRole) || 'hotel_manager',
            actorStaffId: e?.actorStaffId ? staffIdMap.get(asStringId(e.actorStaffId)) : undefined,
            note: asStringId(e?.note),
            patch: e?.patch ?? undefined
          }))
        },
        attachments: {
          create: attachments
            .filter((a: any) => !!a?.dataUrl)
            .map((a: any) => ({
              at: toIsoDate(a?.at) || new Date(),
              name: asStringId(a?.name) || 'photo',
              mime: asStringId(a?.mime) || 'image/*',
              dataUrl: String(a.dataUrl),
              actorRole: asStringId(a?.actorRole) || 'hotel_staff',
              actorStaffId: a?.actorStaffId ? staffIdMap.get(asStringId(a.actorStaffId)) : undefined
            }))
        }
      }
    });
    bump(created, 'tasks');
  }

  // Reservations (token unique)
  for (const r of Object.values(reservationsMap)) {
    const token = asStringId((r as any)?.token);
    if (!token) continue;

    const legacyHotelId = asStringId((r as any)?.hotelId);
    const hotelId = hotelIdMap.get(legacyHotelId);
    if (!hotelId) {
      bump(skipped, 'reservations_missing_hotel');
      continue;
    }

    const mapIds = (ids: any[], map: Map<string, string>): string[] =>
      (Array.isArray(ids) ? ids : [])
        .map((id): string | undefined => map.get(asStringId(id)))
        .filter((value: string | undefined): value is string => Boolean(value));

    const roomIds = mapIds((r as any)?.roomIds, roomIdMap);
    const spaceIds = mapIds((r as any)?.spaceIds, spaceIdMap);

    const remapNotes = (obj: any, map: Map<string, string>) => {
      const out: any = {};
      for (const [k, v] of Object.entries(obj && typeof obj === 'object' ? obj : {})) {
        const nk = map.get(String(k));
        if (nk) out[nk] = v;
      }
      return out;
    };

    const data = {
      organizationId,
      hotelId,
      token,
      statusAdmin: normalizeReservationStatus((r as any)?.statusAdmin || 'PROPOSED') as any,
      statusHotel: normalizeReservationStatus((r as any)?.statusHotel || 'PENDING') as any,
      roomIds,
      spaceIds,
      roomNotes: remapNotes((r as any)?.roomNotes, roomIdMap),
      spaceNotes: remapNotes((r as any)?.spaceNotes, spaceIdMap),
      surfaceDefault: String((r as any)?.surfaceDefault || 'BOTH').toUpperCase() as any,
      roomSurfaceOverrides: remapNotes((r as any)?.roomSurfaceOverrides, roomIdMap),
      notesGlobal: asStringId((r as any)?.notesGlobal),
      notesOrg: asStringId((r as any)?.notesOrg),
      durationMinutes: Number((r as any)?.durationMinutes) || 0,
      proposedDate: asStringId((r as any)?.proposedDate),
      proposedStart: asStringId((r as any)?.proposedStart),
      confirmedAt: toIsoDate((r as any)?.confirmedAt) || undefined,
      requiresAdminApproval: Boolean((r as any)?.requiresAdminApproval),
      cancelledAt: toIsoDate((r as any)?.cancelledAt) || undefined,
      cancelledBy: asStringId((r as any)?.cancelledBy),
      cancelReason: asStringId((r as any)?.cancelReason)
    };

    const exists = await prisma.reservation.findFirst({ where: { token }, select: { id: true } });
    if (exists) {
      await prisma.reservation.update({
        where: { id: exists.id },
        data
      });
      bump(created, 'reservations_updated');
    } else {
      await prisma.reservation.create({
        data: {
          ...data,
          createdAt: toIsoDate((r as any)?.createdAt) || new Date()
        }
      });
      bump(created, 'reservations');
    }
  }

  // Contracts (token unique)
  for (const [legacyContractId, c] of Object.entries(contractsMap)) {
    const token = asStringId((c as any)?.token);
    if (!token) continue;

    const exists = await prisma.contract.findFirst({ where: { token }, select: { id: true } });
    if (exists) {
      bump(skipped, 'contracts');
      continue;
    }

    const legacyHotelId = asStringId((c as any)?.hotelId);
    const hotelId = hotelIdMap.get(legacyHotelId);
    if (!hotelId) {
      bump(skipped, 'contracts_missing_hotel');
      continue;
    }

    await prisma.contract.create({
      data: {
        organizationId,
        hotelId,
        token,
        legacyId: legacyContractId,
        status: String((c as any)?.status || 'SENT').toUpperCase() as any,
        hotelName: asStringId((c as any)?.hotelName),
        contact: (c as any)?.contact ?? {},
        pricing: (c as any)?.pricing ?? {},
        roomsMinPerSession: Number((c as any)?.roomsMinPerSession) || 0,
        roomsMaxPerSession: Number((c as any)?.roomsMaxPerSession) || 0,
        roomsPerSession: Number((c as any)?.roomsPerSession) || 0,
        frequency: String((c as any)?.frequency || 'YEARLY').toUpperCase() as any,
        surfaceType: String((c as any)?.surfaceType || 'BOTH').toUpperCase() as any,
        appliedTier: asStringId((c as any)?.appliedTier),
        appliedPricePerRoom: Number((c as any)?.appliedPricePerRoom) || 0,
        otherSurfaces: (c as any)?.otherSurfaces ?? {},
        totalPerSession: Number((c as any)?.totalPerSession) || 0,
        notes: asStringId((c as any)?.notes),
        sentAt: toIsoDate((c as any)?.sentAt) || new Date(),
        signedBy: asStringId((c as any)?.signedBy),
        acceptedAt: toIsoDate((c as any)?.acceptedAt) || undefined
      }
    });
    bump(created, 'contracts');
  }

  if (!hotelScopeId && pricingDefaults) {
    await prisma.pricingDefaults.upsert({
      where: { organizationId },
      create: {
        organizationId,
        roomsMinPerSession: Number(pricingDefaults?.roomsMinPerSession) || 10,
        roomsMaxPerSession: Number(pricingDefaults?.roomsMaxPerSession) || 20,
        basePrices: pricingDefaults?.basePrices ?? {},
        penaltyPrices: pricingDefaults?.penaltyPrices ?? {},
        contractPrices: pricingDefaults?.contractPrices ?? {},
        advantagePrices: pricingDefaults?.advantagePrices ?? {},
        sqftPrices: pricingDefaults?.sqftPrices ?? {}
      },
      update: {
        roomsMinPerSession: Number(pricingDefaults?.roomsMinPerSession) || 10,
        roomsMaxPerSession: Number(pricingDefaults?.roomsMaxPerSession) || 20,
        basePrices: pricingDefaults?.basePrices ?? {},
        penaltyPrices: pricingDefaults?.penaltyPrices ?? {},
        contractPrices: pricingDefaults?.contractPrices ?? {},
        advantagePrices: pricingDefaults?.advantagePrices ?? {},
        sqftPrices: pricingDefaults?.sqftPrices ?? {}
      }
    });
    bump(created, 'pricing_defaults');
  }

  return { created, skipped };
}
