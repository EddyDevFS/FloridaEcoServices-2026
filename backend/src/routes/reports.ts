import { Router, type Response } from 'express';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireHotelScope } from '../auth/scope';

const router = Router();

function normalizeDateOnly(v: any): string | null {
  const s = String(v || '').trim();
  if (!s) return null;
  // Expect YYYY-MM-DD; keep as-is if valid.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normalizeYear(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const y = Math.floor(n);
  if (y < 2020 || y > 2100) return null;
  return y;
}

type Surface = 'CARPET' | 'TILE' | 'BOTH';
function normalizeSurface(v: any): Surface {
  const s = String(v || '').trim().toUpperCase();
  if (s === 'CARPET' || s === 'TILE' || s === 'BOTH') return s as Surface;
  return 'BOTH';
}

function initBuckets() {
  return { CARPET: 0, TILE: 0, BOTH: 0 };
}

router.get('/reports/annual', requireAuth, async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.query.hotelId || '').trim();
  const year = normalizeYear(req.query.year);
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (!year) return res.status(400).json({ error: 'invalid_year' });
  if (!requireHotelScope(req, res, hotelId)) return;

  const prisma = getPrisma();
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!hotel) return res.status(404).json({ error: 'hotel_not_found' });

  const reservations = await prisma.reservation.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      hotelId,
      statusAdmin: 'APPROVED',
      statusHotel: 'APPROVED'
    },
    orderBy: [{ proposedDate: 'asc' }, { createdAt: 'asc' }]
  });

  const totals = initBuckets();
  const months = Array.from({ length: 12 }, (_, idx) => ({
    month: idx + 1,
    ...initBuckets(),
    totalRooms: 0
  }));

  for (const r of reservations) {
    const dt = normalizeDateOnly(r.confirmedAt ? r.confirmedAt.toISOString() : r.proposedDate);
    if (!dt) continue;
    const y = Number(dt.slice(0, 4));
    if (y !== year) continue;
    const mIdx = Number(dt.slice(5, 7)) - 1;
    if (!(mIdx >= 0 && mIdx < 12)) continue;

    const roomIds: string[] = Array.isArray(r.roomIds) ? (r.roomIds as any).map(String) : [];
    const overrides: Record<string, any> = (r.roomSurfaceOverrides && typeof r.roomSurfaceOverrides === 'object') ? (r.roomSurfaceOverrides as any) : {};
    const defaultSurface = normalizeSurface(r.surfaceDefault);

    for (const roomId of roomIds) {
      const surface = normalizeSurface(overrides?.[roomId] ?? defaultSurface);
      totals[surface] += 1;
      months[mIdx][surface] += 1;
      months[mIdx].totalRooms += 1;
    }
  }

  const derived = {
    carpetEquivalent: totals.CARPET + totals.BOTH,
    tileEquivalent: totals.TILE + totals.BOTH
  };

  res.json({
    year,
    hotelId,
    totals,
    derived,
    months
  });
});

router.get('/reports/roadmap', requireAuth, async (req: AuthedRequest, res: Response) => {
  const hotelId = String(req.query.hotelId || '').trim();
  const date = normalizeDateOnly(req.query.date);
  if (!hotelId) return res.status(400).json({ error: 'missing_hotel_id' });
  if (!date) return res.status(400).json({ error: 'invalid_date' });
  if (!requireHotelScope(req, res, hotelId)) return;

  const prisma = getPrisma();
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, organizationId: req.auth!.organizationId },
    select: { id: true }
  });
  if (!hotel) return res.status(404).json({ error: 'hotel_not_found' });

  const reservations = await prisma.reservation.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      hotelId,
      proposedDate: date,
      statusAdmin: 'APPROVED',
      statusHotel: 'APPROVED'
    },
    orderBy: [{ proposedStart: 'asc' }, { createdAt: 'asc' }]
  });

  const allRoomIds = new Set<string>();
  const allSpaceIds = new Set<string>();
  for (const r of reservations) {
    (Array.isArray(r.roomIds) ? r.roomIds : []).forEach((id: any) => allRoomIds.add(String(id)));
    (Array.isArray(r.spaceIds) ? r.spaceIds : []).forEach((id: any) => allSpaceIds.add(String(id)));
  }

  const rooms = allRoomIds.size
    ? await prisma.room.findMany({
        where: { id: { in: Array.from(allRoomIds) }, floor: { building: { hotelId } } },
        select: { id: true, roomNumber: true, surface: true, sqft: true }
      })
    : [];
  const spaces = allSpaceIds.size
    ? await prisma.space.findMany({
        where: { id: { in: Array.from(allSpaceIds) }, floor: { building: { hotelId } } },
        select: { id: true, name: true, type: true, sqft: true }
      })
    : [];

  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const spaceById = new Map(spaces.map((s) => [s.id, s]));

  const openTasks = await prisma.task.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      hotelId,
      status: { not: 'DONE' }
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    include: { locations: true }
  });

  const items = reservations.map((r) => {
    const defaultSurface = normalizeSurface(r.surfaceDefault);
    const overrides: Record<string, any> = (r.roomSurfaceOverrides && typeof r.roomSurfaceOverrides === 'object') ? (r.roomSurfaceOverrides as any) : {};
    const roomNotes: Record<string, any> = (r.roomNotes && typeof r.roomNotes === 'object') ? (r.roomNotes as any) : {};
    const spaceNotes: Record<string, any> = (r.spaceNotes && typeof r.spaceNotes === 'object') ? (r.spaceNotes as any) : {};

    const roomIds: string[] = Array.isArray(r.roomIds) ? (r.roomIds as any).map(String) : [];
    const spaceIds: string[] = Array.isArray(r.spaceIds) ? (r.spaceIds as any).map(String) : [];

    const roomList = roomIds
      .map((id) => {
        const base = roomById.get(id);
        const surface = normalizeSurface(overrides?.[id] ?? defaultSurface);
        return {
          id,
          roomNumber: base?.roomNumber || '',
          sqft: base?.sqft ?? null,
          surface,
          note: String(roomNotes?.[id] || '').trim()
        };
      })
      .sort((a, b) => (a.roomNumber || '').localeCompare(b.roomNumber || ''));

    const spaceList = spaceIds
      .map((id) => {
        const base = spaceById.get(id);
        return {
          id,
          name: base?.name || '',
          type: base?.type || 'CORRIDOR',
          sqft: base?.sqft ?? null,
          note: String(spaceNotes?.[id] || '').trim()
        };
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Tasks that target these roomIds / spaceIds (best-effort)
    const locationTaskIds = new Set<string>([...roomIds, ...spaceIds]);
    const relatedTasks = openTasks.filter((t) =>
      (t.locations || []).some((loc: any) => {
        const rid = loc.roomId ? String(loc.roomId) : '';
        const sid = loc.spaceId ? String(loc.spaceId) : '';
        return (rid && locationTaskIds.has(rid)) || (sid && locationTaskIds.has(sid));
      })
    );

    return {
      id: r.id,
      token: r.token,
      proposedStart: r.proposedStart,
      durationMinutes: r.durationMinutes,
      notesGlobal: r.notesGlobal || '',
      notesOrg: r.notesOrg || '',
      rooms: roomList,
      spaces: spaceList,
      tasks: relatedTasks.map((t) => ({
        id: t.id,
        status: t.status,
        priority: t.priority,
        type: t.type,
        description: t.description,
        assignedStaffId: t.assignedStaffId || null
      }))
    };
  });

  res.json({
    hotelId,
    date,
    reservations: items
  });
});

export default router;

