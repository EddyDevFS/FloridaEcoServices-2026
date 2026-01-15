import { readFile } from 'fs/promises';
import { randomBytes } from 'crypto';
import { getPrisma } from '../db';

function die(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[import] ${msg}`);
  process.exit(1);
}

function makeStaffToken(): string {
  return `stafftok_${randomBytes(12).toString('hex')}`;
}

function parseJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    die('Invalid JSON export');
  }
}

function asObjMap(v: any): Record<string, any> {
  if (!v || typeof v !== 'object') return {};
  return v as Record<string, any>;
}

function toIsoDate(value: any): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) die('Usage: node dist/scripts/importLocalStorage.js /path/to/export.json');

  const prisma = getPrisma();

  const raw = await readFile(filePath, 'utf-8');
  const data = parseJson(raw);

  const importOrgId = String(process.env.IMPORT_ORG_ID || '').trim();
  const importAdminEmail = String(process.env.IMPORT_ADMIN_EMAIL || '').trim().toLowerCase();

  let organizationId: string | null = null;
  if (importOrgId) {
    const org = await prisma.organization.findUnique({ where: { id: importOrgId }, select: { id: true } });
    if (!org) die(`Organization not found: ${importOrgId}`);
    organizationId = org.id;
  } else if (importAdminEmail) {
    const user = await prisma.user.findUnique({
      where: { email: importAdminEmail },
      select: { organizationId: true }
    });
    if (!user) die(`User not found for IMPORT_ADMIN_EMAIL: ${importAdminEmail}`);
    organizationId = user.organizationId;
  } else {
    const orgs = await prisma.organization.findMany({ select: { id: true }, take: 2 });
    if (orgs.length === 1) organizationId = orgs[0].id;
    else die('Set IMPORT_ORG_ID or IMPORT_ADMIN_EMAIL (multiple orgs found).');
  }

  const hotels = asObjMap(data?.hotels);
  const staffMap = asObjMap(data?.staff);
  const tasksMap = asObjMap(data?.tasks);
  const reservationsMap = asObjMap(data?.reservations);
  const sessionsMap = asObjMap(data?.sessions);
  const techniciansMap = asObjMap(data?.technicians);
  const blocked = Array.isArray(data?.availability?.blocked) ? data.availability.blocked : [];
  const contractsMap = asObjMap(data?.contracts);
  const pricingDefaults = data?.pricing?.defaults ?? null;

  const created: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const bump = (bucket: Record<string, number>, key: string, n = 1) => (bucket[key] = (bucket[key] || 0) + n);

  const hotelIdMap = new Map<string, string>(); // legacy -> db
  const buildingIdMap = new Map<string, string>();
  const floorIdMap = new Map<string, string>();
  const roomIdMap = new Map<string, string>();
  const spaceIdMap = new Map<string, string>();
  const staffIdMap = new Map<string, string>();
  const technicianIdMap = new Map<string, string>();

  // 1) Hotels + structure
  for (const [legacyHotelId, hotel] of Object.entries(hotels)) {
    const name = String((hotel as any)?.name || '').trim();
    if (!name) continue;

    const upserted = await prisma.hotel.upsert({
      where: { organizationId_legacyId: { organizationId, legacyId: legacyHotelId } },
      create: { organizationId, legacyId: legacyHotelId, name },
      update: { name }
    });
    hotelIdMap.set(legacyHotelId, upserted.id);
    bump(created, 'hotels', 1);

    const buildings = Array.isArray((hotel as any)?.buildings) ? (hotel as any).buildings : [];
    for (const b of buildings) {
      const legacyBuildingId = String(b?.id || '').trim();
      const bName = String(b?.name || '').trim();
      if (!legacyBuildingId || !bName) continue;

      const building = await prisma.building.upsert({
        where: { hotelId_legacyId: { hotelId: upserted.id, legacyId: legacyBuildingId } },
        create: { hotelId: upserted.id, legacyId: legacyBuildingId, name: bName, notes: String(b?.notes || '') },
        update: { name: bName, notes: String(b?.notes || '') }
      });
      buildingIdMap.set(legacyBuildingId, building.id);
      bump(created, 'buildings', 1);

      const floors = Array.isArray(b?.floors) ? b.floors : [];
      for (const f of floors) {
        const legacyFloorId = String(f?.id || '').trim();
        const nameOrNumber = String(f?.nameOrNumber || '').trim();
        if (!legacyFloorId || !nameOrNumber) continue;

        const floor = await prisma.floor.upsert({
          where: { buildingId_legacyId: { buildingId: building.id, legacyId: legacyFloorId } },
          create: { buildingId: building.id, legacyId: legacyFloorId, nameOrNumber },
          update: { nameOrNumber }
        });
        floorIdMap.set(legacyFloorId, floor.id);
        bump(created, 'floors', 1);

        const rooms = Array.isArray(f?.rooms) ? f.rooms : [];
        for (const r of rooms) {
          const legacyRoomId = String(r?.id || '').trim();
          const roomNumber = String(r?.roomNumber || '').trim();
          if (!legacyRoomId || !roomNumber) continue;

          const room = await prisma.room.upsert({
            where: { floorId_legacyId: { floorId: floor.id, legacyId: legacyRoomId } },
            create: {
              floorId: floor.id,
              legacyId: legacyRoomId,
              roomNumber,
              active: r?.active !== false,
              surface: String(r?.surface || 'BOTH').toUpperCase() as any,
              sqft: r?.sqft != null ? Number(r.sqft) : undefined
            },
            update: {
              roomNumber,
              active: r?.active !== false,
              surface: String(r?.surface || 'BOTH').toUpperCase() as any,
              sqft: r?.sqft != null ? Number(r.sqft) : undefined
            }
          });
          roomIdMap.set(legacyRoomId, room.id);
          bump(created, 'rooms', 1);
        }

        const spaces = Array.isArray(f?.spaces) ? f.spaces : [];
        for (const s of spaces) {
          const legacySpaceId = String(s?.id || '').trim();
          const sName = String(s?.name || '').trim();
          if (!legacySpaceId || !sName) continue;

          const space = await prisma.space.upsert({
            where: { floorId_legacyId: { floorId: floor.id, legacyId: legacySpaceId } },
            create: {
              floorId: floor.id,
              legacyId: legacySpaceId,
              name: sName,
              active: s?.active !== false,
              sqft: s?.sqft != null ? Number(s.sqft) : undefined
            },
            update: {
              name: sName,
              active: s?.active !== false,
              sqft: s?.sqft != null ? Number(s.sqft) : undefined
            }
          });
          spaceIdMap.set(legacySpaceId, space.id);
          bump(created, 'spaces', 1);
        }
      }
    }
  }

  // 2) Staff
  for (const [legacyStaffId, member] of Object.entries(staffMap)) {
    const legacyHotelId = String((member as any)?.hotelId || '').trim();
    const hotelId = hotelIdMap.get(legacyHotelId);
    if (!hotelId) {
      bump(skipped, 'staff_missing_hotel', 1);
      continue;
    }

    const existing = await prisma.staffMember.findUnique({
      where: { organizationId_legacyId: { organizationId, legacyId: legacyStaffId } },
      select: { id: true }
    });
    if (existing) {
      staffIdMap.set(legacyStaffId, existing.id);
      bump(skipped, 'staff', 1);
      continue;
    }

    const importedToken = String((member as any)?.token || '').trim();
    let token = importedToken || makeStaffToken();
    if (token) {
      const tokenExists = await prisma.staffMember.findUnique({ where: { token }, select: { id: true } });
      if (tokenExists) token = makeStaffToken();
    }

    const createdMember = await prisma.staffMember.create({
      data: {
        organizationId,
        hotelId,
        legacyId: legacyStaffId,
        token,
        firstName: String((member as any)?.firstName || '').trim(),
        lastName: String((member as any)?.lastName || '').trim(),
        phone: String((member as any)?.phone || '').trim(),
        notes: String((member as any)?.notes || '').trim(),
        active: (member as any)?.active !== false
      },
      select: { id: true }
    });
    staffIdMap.set(legacyStaffId, createdMember.id);
    bump(created, 'staff', 1);
  }

  // 3) Technicians
  for (const [legacyTechId, tech] of Object.entries(techniciansMap)) {
    const existing = await prisma.technician.findUnique({
      where: { organizationId_legacyId: { organizationId, legacyId: legacyTechId } },
      select: { id: true }
    });
    if (existing) {
      technicianIdMap.set(legacyTechId, existing.id);
      bump(skipped, 'technicians', 1);
      continue;
    }
    const createdTech = await prisma.technician.create({
      data: {
        organizationId,
        legacyId: legacyTechId,
        name: String((tech as any)?.name || '').trim() || 'Technician',
        phone: String((tech as any)?.phone || '').trim(),
        notes: String((tech as any)?.notes || '').trim(),
        active: (tech as any)?.active !== false
      },
      select: { id: true }
    });
    technicianIdMap.set(legacyTechId, createdTech.id);
    bump(created, 'technicians', 1);
  }

  // 4) Blocked slots
  for (const slot of blocked) {
    const legacyId = String(slot?.id || '').trim();
    if (!legacyId) continue;

    const existing = await prisma.blockedSlot.findUnique({
      where: { organizationId_legacyId: { organizationId, legacyId } },
      select: { id: true }
    });
    if (existing) {
      bump(skipped, 'blocked_slots', 1);
      continue;
    }
    await prisma.blockedSlot.create({
      data: {
        organizationId,
        legacyId,
        date: String(slot?.date || '').trim(),
        start: String(slot?.start || '').trim(),
        end: String(slot?.end || '').trim(),
        note: String(slot?.note || '').trim()
      }
    });
    bump(created, 'blocked_slots', 1);
  }

  // 5) Sessions
  for (const [legacySessionId, s] of Object.entries(sessionsMap)) {
    const legacyHotelId = String((s as any)?.hotelId || '').trim();
    const hotelId = hotelIdMap.get(legacyHotelId);
    if (!hotelId) {
      bump(skipped, 'sessions_missing_hotel', 1);
      continue;
    }

    const existing = await prisma.session.findUnique({
      where: { organizationId_legacyId: { organizationId, legacyId: legacySessionId } },
      select: { id: true }
    });
    if (existing) {
      bump(skipped, 'sessions', 1);
      continue;
    }

    const legacyRoomIds = Array.isArray((s as any)?.roomIds) ? (s as any).roomIds : [];
    const roomIds = legacyRoomIds
      .map((rid: any): string | undefined => roomIdMap.get(String(rid)))
      .filter((value: string | undefined): value is string => Boolean(value));

    const legacyTechId = String((s as any)?.technicianId || '').trim();
    const technicianId = legacyTechId ? technicianIdMap.get(legacyTechId) : undefined;

    await prisma.session.create({
      data: {
        organizationId,
        hotelId,
        legacyId: legacySessionId,
        roomIds,
        date: String((s as any)?.date || '').trim(),
        start: String((s as any)?.start || '').trim(),
        end: String((s as any)?.end || '').trim(),
        technicianId
      }
    });
    bump(created, 'sessions', 1);
  }

  // 6) Tasks (includes incidents) — create-only, skip if already imported
  for (const [legacyTaskId, t] of Object.entries(tasksMap)) {
    const legacyHotelId = String((t as any)?.hotelId || '').trim();
    const hotelId = hotelIdMap.get(legacyHotelId);
    if (!hotelId) {
      bump(skipped, 'tasks_missing_hotel', 1);
      continue;
    }

    const exists = await prisma.task.findUnique({
      where: { organizationId_legacyId: { organizationId, legacyId: legacyTaskId } },
      select: { id: true }
    });
    if (exists) {
      bump(skipped, 'tasks', 1);
      continue;
    }

    const assignedLegacy = (t as any)?.assignedStaffId ? String((t as any).assignedStaffId).trim() : '';
    const assignedStaffId = assignedLegacy ? staffIdMap.get(assignedLegacy) : undefined;

    const createdAt = toIsoDate((t as any)?.createdAt) || new Date();
    const updatedAt = toIsoDate((t as any)?.updatedAt) || createdAt;

    const category = String((t as any)?.category || 'TASK').trim().toUpperCase() === 'INCIDENT' ? 'INCIDENT' : 'TASK';
    const status = String((t as any)?.status || 'OPEN').trim().toUpperCase();
    const priority = String((t as any)?.priority || 'NORMAL').trim().toUpperCase();
    const type = String((t as any)?.type || 'OTHER').trim() || 'OTHER';
    const description = String((t as any)?.description || '').trim();

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
          create: locations.map((l: any) => ({ label: String(l?.label || '').trim() }))
        },
        events: {
          create: events.map((e: any) => ({
            at: toIsoDate(e?.at) || new Date(),
            action: String(e?.action || '').trim() || 'NOTE',
            actorRole: String(e?.actorRole || 'hotel_manager').trim() || 'hotel_manager',
            actorStaffId: e?.actorStaffId ? String(e.actorStaffId).trim() : undefined,
            note: String(e?.note || '').trim(),
            patch: e?.patch ?? undefined
          }))
        },
        attachments: {
          create: attachments.map((a: any) => ({
            at: toIsoDate(a?.at) || new Date(),
            name: String(a?.name || 'photo').trim(),
            mime: String(a?.mime || 'image/*').trim(),
            dataUrl: a?.dataUrl ? String(a.dataUrl) : undefined,
            actorRole: String(a?.actorRole || 'hotel_staff').trim() || 'hotel_staff',
            actorStaffId: a?.actorStaffId ? String(a.actorStaffId).trim() : undefined
          }))
        }
      }
    });
    bump(created, 'tasks', 1);
  }

  // 7) Reservations (token is unique) — create-only, skip if token exists
  for (const r of Object.values(reservationsMap)) {
    const token = String((r as any)?.token || '').trim();
    if (!token) continue;

    const exists = await prisma.reservation.findFirst({ where: { token }, select: { id: true } });
    if (exists) {
      bump(skipped, 'reservations', 1);
      continue;
    }

    const legacyHotelId = String((r as any)?.hotelId || '').trim();
    const hotelId = hotelIdMap.get(legacyHotelId);
    if (!hotelId) {
      bump(skipped, 'reservations_missing_hotel', 1);
      continue;
    }

    const mapIds = (ids: any[], map: Map<string, string>): string[] =>
      (Array.isArray(ids) ? ids : [])
        .map((id): string | undefined => map.get(String(id)))
        .filter((value: string | undefined): value is string => Boolean(value));

    const roomIds = mapIds((r as any)?.roomIds, roomIdMap);
    const spaceIds = mapIds((r as any)?.spaceIds, spaceIdMap);

    const remapNotes = (obj: any, map: Map<string, string>) => {
      const out: any = {};
      for (const [k, v] of Object.entries(asObjMap(obj))) {
        const nk = map.get(String(k));
        if (nk) out[nk] = v;
      }
      return out;
    };

    await prisma.reservation.create({
      data: {
        organizationId,
        hotelId,
        token,
        statusAdmin: String((r as any)?.statusAdmin || 'PROPOSED').toUpperCase() as any,
        statusHotel: String((r as any)?.statusHotel || 'PENDING').toUpperCase() as any,
        roomIds,
        spaceIds,
        roomNotes: remapNotes((r as any)?.roomNotes, roomIdMap),
        spaceNotes: remapNotes((r as any)?.spaceNotes, spaceIdMap),
        surfaceDefault: String((r as any)?.surfaceDefault || 'BOTH').toUpperCase() as any,
        roomSurfaceOverrides: remapNotes((r as any)?.roomSurfaceOverrides, roomIdMap),
        notesGlobal: String((r as any)?.notesGlobal || ''),
        notesOrg: String((r as any)?.notesOrg || ''),
        durationMinutes: Number((r as any)?.durationMinutes) || 0,
        proposedDate: String((r as any)?.proposedDate || ''),
        proposedStart: String((r as any)?.proposedStart || ''),
        confirmedAt: toIsoDate((r as any)?.confirmedAt) || undefined,
        requiresAdminApproval: Boolean((r as any)?.requiresAdminApproval),
        cancelledAt: toIsoDate((r as any)?.cancelledAt) || undefined,
        cancelledBy: String((r as any)?.cancelledBy || ''),
        cancelReason: String((r as any)?.cancelReason || ''),
        createdAt: toIsoDate((r as any)?.createdAt) || new Date()
      }
    });
    bump(created, 'reservations', 1);
  }

  // 8) Contracts (token is unique) — create-only, skip if token exists
  for (const [legacyContractId, c] of Object.entries(contractsMap)) {
    const token = String((c as any)?.token || '').trim();
    if (!token) continue;

    const exists = await prisma.contract.findFirst({ where: { token }, select: { id: true } });
    if (exists) {
      bump(skipped, 'contracts', 1);
      continue;
    }

    const legacyHotelId = String((c as any)?.hotelId || '').trim();
    const hotelId = hotelIdMap.get(legacyHotelId);
    if (!hotelId) {
      bump(skipped, 'contracts_missing_hotel', 1);
      continue;
    }

    await prisma.contract.create({
      data: {
        organizationId,
        hotelId,
        token,
        legacyId: legacyContractId,
        status: String((c as any)?.status || 'SENT').toUpperCase() as any,
        hotelName: String((c as any)?.hotelName || ''),
        contact: (c as any)?.contact ?? {},
        pricing: (c as any)?.pricing ?? {},
        roomsMinPerSession: Number((c as any)?.roomsMinPerSession) || 0,
        roomsMaxPerSession: Number((c as any)?.roomsMaxPerSession) || 0,
        roomsPerSession: Number((c as any)?.roomsPerSession) || 0,
        frequency: String((c as any)?.frequency || 'YEARLY').toUpperCase() as any,
        surfaceType: String((c as any)?.surfaceType || 'BOTH').toUpperCase() as any,
        appliedTier: String((c as any)?.appliedTier || ''),
        appliedPricePerRoom: Number((c as any)?.appliedPricePerRoom) || 0,
        otherSurfaces: (c as any)?.otherSurfaces ?? {},
        totalPerSession: Number((c as any)?.totalPerSession) || 0,
        notes: String((c as any)?.notes || ''),
        sentAt: toIsoDate((c as any)?.sentAt) || new Date(),
        signedBy: String((c as any)?.signedBy || ''),
        acceptedAt: toIsoDate((c as any)?.acceptedAt) || undefined
      }
    });
    bump(created, 'contracts', 1);
  }

  // 9) Pricing defaults (upsert per org)
  if (pricingDefaults) {
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
    bump(created, 'pricing_defaults', 1);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ organizationId, created, skipped }, null, 2));
}

main().catch((err) => {
  die(err?.message || String(err));
});
