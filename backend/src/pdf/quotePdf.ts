import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';

const BRAND = {
  name: 'Florida Eco Services',
  address1: '2100 Olympus Blvd, Apt 2315',
  address2: 'Clermont, FL 34714',
  contactName: 'Eddy Sallault',
  contactTitle: 'Business Owner',
  phone: '(786) 757-4703',
  email: 'eddy@floridaecoservices.com'
};

function findLogoPath() {
  const filename = 'logo-florida-eco-services.png';
  const candidates = [
    // When running from /backend (docker-compose context or local)
    path.resolve(process.cwd(), 'assets', filename),
    // When running from repo root
    path.resolve(process.cwd(), 'backend', 'assets', filename),
    // When running compiled code (dist/pdf) - keep a relative fallback
    path.resolve(__dirname, '..', '..', 'assets', filename)
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function money(n: number) {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function num(n: number) {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function clampInt(v: any, min: number, max: number) {
  let n = parseInt(String(v ?? ''), 10);
  if (Number.isNaN(n)) n = min;
  return Math.max(min, Math.min(max, n));
}

type QuotePayload = any;

function computeFromPayload(payload: QuotePayload) {
  const state = payload && typeof payload === 'object' ? payload : {};
  const mode = String(state.mode || 'quick');

  const buildingsCount = clampInt(state.buildingsCount, 1, 25);
  const buildings = Array.isArray(state.buildings) ? state.buildings.slice(0, buildingsCount) : [];
  while (buildings.length < buildingsCount) buildings.push({ floors: 0, roomsPerFloor: 0 });

  let roomsCalculated = 0;
  for (const b of buildings) roomsCalculated += clampInt(b?.floors, 0, 99) * clampInt(b?.roomsPerFloor, 0, 200);

  const roomsOverride = state.roomsOverride;
  const roomsFinal =
    roomsOverride !== null && roomsOverride !== undefined && roomsOverride !== '' && !Number.isNaN(parseInt(String(roomsOverride), 10))
      ? clampInt(roomsOverride, 0, 99999)
      : roomsCalculated;

  const corridor = state.corridor || {};
  const corridorEnabled = !!corridor.enabled;
  const qty = clampInt(corridor.qty, 0, 9999);
  const sqftPer = clampInt(corridor.sqftPer, 0, 999999);
  const sqftCalculated = corridorEnabled ? qty * sqftPer : 0;
  const sqftOverride = corridor.sqftOverride;
  const corridorSqft =
    corridorEnabled && sqftOverride !== null && sqftOverride !== undefined && sqftOverride !== '' && !Number.isNaN(parseInt(String(sqftOverride), 10))
      ? clampInt(sqftOverride, 0, 999999999)
      : sqftCalculated;

  const pricing = state.pricing || {};
  const minRooms = clampInt(pricing.minRooms, 0, 99999);
  const plans = pricing.plans || {};

  const roomMix = state.roomMix || {};
  const mixCarpet = clampInt(roomMix.carpet, 0, 999999);
  const mixTile = clampInt(roomMix.tile, 0, 999999);
  const mixBoth = clampInt(roomMix.both, 0, 999999);
  const mixOk = mode !== 'advanced' ? true : mixCarpet + mixTile + mixBoth === roomsFinal;

  const computeAnnualForPlan = (planKey: string) => {
    const plan = plans?.[planKey] || {};
    const room = plan.room || {};
    const tileSqftPrice = Number(plan.tileSqft ?? plan.tileSqftPrice ?? plan.corridorSqft) || 0;
    const carpetSqftPrice = Number(plan.carpetSqft ?? plan.carpetSqftPrice ?? plan.corridorSqft) || 0;
    const billedRooms = Math.max(roomsFinal, minRooms);

    let roomsCost = 0;
    if (roomsFinal <= 0) roomsCost = 0;
    else if (mode === 'advanced' && mixOk) {
      roomsCost = mixCarpet * (Number(room.carpet) || 0) + mixTile * (Number(room.tile) || 0) + mixBoth * (Number(room.both) || 0);
      if (billedRooms > roomsFinal) roomsCost += (billedRooms - roomsFinal) * (Number(room.both) || 0);
    } else {
      roomsCost = billedRooms * (Number(room.both) || 0);
    }

    const corridorSurface = String(state?.corridor?.surface || 'carpet');
    const corridorRate = corridorSurface === 'tile' ? tileSqftPrice : carpetSqftPrice;
    const corridorCost = corridorSqft * corridorRate;
    const totalAnnual = roomsCost + corridorCost;
    const avgPerRoom = billedRooms ? roomsCost / billedRooms : 0;

    return { roomsCost, corridorCost, totalAnnual, avgPerRoom, billedRooms, tileSqftPrice, carpetSqftPrice };
  };

  const onDemand = computeAnnualForPlan('ondemand');
  const partner = computeAnnualForPlan('partner');
  const total = computeAnnualForPlan('total');

  const frequency = String(state.currentFrequency || '');
  const currentFreqLabel =
    {
      '1/year': '1 time / year',
      '2/year': '2 times / year',
      '3/year': '3 times / year',
      quarterly: 'Quarterly',
      monthly: 'Monthly program',
      unknown: 'Not sure'
    }[frequency] || '—';

  const hotel = state.hotel || {};

  return {
    hotelName: String(hotel.name || '').trim(),
    hotelAddress: String(hotel.address || '').trim(),
    hotelTel: String(hotel.tel || '').trim(),
    hotelContact: String(hotel.contact || '').trim(),
    hotelEmail: String(hotel.email || '').trim(),
    roomsCalculated,
    roomsFinal,
    corridorSqft,
    currentFreqLabel,
    offers: { ondemand: onDemand, partner, total }
  };
}

export async function renderQuotePdf(opts: {
  quoteNumber: number | null;
  title: string;
  customer: { company?: string; contact?: string; email?: string; phone?: string };
  payload: QuotePayload;
  acceptance?: {
    acceptedAt: Date;
    acceptedPlanKey: string;
    signedByName: string;
    signedByTitle: string;
    signedByEmail: string;
  } | null;
}) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
  const chunks: Buffer[] = [];

  doc.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // ---------- Data ----------
  const computed = computeFromPayload(opts.payload);
  const quoteNo = opts.quoteNumber ? `#${opts.quoteNumber}` : '';
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });

  const company = String(opts.customer?.company || computed.hotelName || opts.title || '').trim();
  const contact = String(opts.customer?.contact || computed.hotelContact || '').trim();
  const email = String(opts.customer?.email || computed.hotelEmail || '').trim();
  const phone = String(opts.customer?.phone || computed.hotelTel || '').trim();

  const acceptedKey = String(opts.acceptance?.acceptedPlanKey || '').trim();
  const chosenKey = acceptedKey || 'total';

  const offerCopy = (key: string) =>
    key === 'ondemand'
      ? { title: 'On-Demand', subtitle: 'One-time or urgent requests', badge: '' }
      : key === 'partner'
        ? { title: 'Refresh Plan', subtitle: 'Yearly refresh for partial coverage', badge: 'GREAT OFFER' }
        : { title: 'Total Care', subtitle: 'Full coverage + priority scheduling', badge: "HOTEL'S CHOICE" };

  const money0 = (n: number) => {
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  };
  const num0 = (n: number) => {
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-US').format(Math.round(n));
  };

  const rawPlans =
    (opts.payload && typeof opts.payload === 'object' ? (opts.payload as any).pricing?.plans : null) || {};

  const planRoom = (key: string) => {
    const plan = rawPlans?.[key] || {};
    const room = plan.room || {};
    return {
      carpet: Number(room.carpet) || 0,
      tile: Number(room.tile) || 0,
      both: Number(room.both) || 0
    };
  };

  // ---------- Layout constants (STRICT 1 page) ----------
  const left = doc.page.margins.left;
  const top = doc.page.margins.top;
  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const H = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

  const C = {
    ink: '#111827',
    sub: '#374151',
    muted: '#6b7280',
    line: '#e5e7eb',
    soft: '#f3f4f6',
    card: '#ffffff',
    brand: '#0b6b55',
    brandSoft: '#e7f7f1'
  };

  const rr = (x: number) => Math.round(x);

  const roundRect = (x: number, y: number, w: number, h: number, radius = 12) => {
    doc.roundedRect(rr(x), rr(y), rr(w), rr(h), radius);
  };

  const drawCard = (x: number, y: number, w: number, h: number) => {
    doc.save();
    roundRect(x, y, w, h, 14);
    doc.lineWidth(1).strokeColor(C.line).fillColor(C.card).fillAndStroke();
    doc.restore();
  };

  const hr = (y: number) => {
    doc.save();
    doc.moveTo(left, rr(y)).lineTo(left + W, rr(y)).lineWidth(1).strokeColor(C.line).stroke();
    doc.restore();
  };

  const drawBadge = (x: number, y: number, label: string) => {
    if (!label) return;
    doc.save();
    doc.font('Helvetica-Bold').fontSize(8);
    const padX = 8, padY = 4;
    const w = doc.widthOfString(label) + padX * 2;
    const h = 16;
    roundRect(x, y, w, h, 8);
    doc.fillColor(C.brandSoft).fill();
    doc.fillColor(C.brand).text(label, x + padX, y + padY - 1, { width: w - padX * 2, align: 'center' });
    doc.restore();
  };

  // ---------- Header ----------
  const headerH = 86;
  const headerY = top;

  doc.save();
  doc.rect(left, headerY, W, 3).fillColor(C.brand).fill();
  doc.restore();

  const logoPath = findLogoPath();
  const hasLogo = !!logoPath;
  const logoW = 120, logoH = 44;

  if (logoPath) {
    try { doc.image(logoPath, left, headerY + 12, { fit: [logoW, logoH] }); } catch {}
  }

  const titleX = left + (hasLogo ? logoW + 14 : 0);
  const titleW = W - (hasLogo ? logoW + 14 : 0) - 190;

  doc.save();
  doc.font('Helvetica-Bold').fontSize(18).fillColor(C.ink).text('Quote', titleX, headerY + 10, { width: titleW });
  doc.font('Helvetica').fontSize(10).fillColor(C.sub).text('Commercial carpet + tile & grout cleaning', titleX, headerY + 34, { width: titleW });
  doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(`${BRAND.name} • ${BRAND.phone} • ${BRAND.email}`, titleX, headerY + 54, {
    width: titleW
  });
  doc.restore();

  const metaX = left + W - 190;
  doc.save();
  roundRect(metaX, headerY + 12, 190, 56, 12);
  doc.fillColor(C.soft).fill();
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10).text('Document', metaX + 12, headerY + 20, { width: 166 });
  doc.fillColor(C.sub).font('Helvetica').fontSize(9).text([quoteNo ? `Quote ${quoteNo}` : 'Quote', `Date: ${now}`].join('\n'), metaX + 12, headerY + 36, {
    width: 166
  });
  doc.restore();

  hr(headerY + headerH);

  // ---------- Row 1: Customer + Scope ----------
  const row1Y = headerY + headerH + 14;
  const row1H = 92;
  const colGap = 14;
  const colA = (W - colGap) * 0.58;
  const colB = W - colGap - colA;

  const customerX = left;
  const scopeX = left + colA + colGap;

  drawCard(customerX, row1Y, colA, row1H);
  drawCard(scopeX, row1Y, colB, row1H);

  // Customer
  doc.save();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text('Customer', customerX + 14, row1Y + 12, { width: colA - 28 });
  const custLines = [company || '—', contact || '', email || '', phone || ''].filter(Boolean).slice(0, 4);
  doc.font('Helvetica').fontSize(10).fillColor(C.sub).text(custLines.join('\n'), customerX + 14, row1Y + 32, { width: colA - 28 });
  doc.restore();

  // Scope
  doc.save();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text('Scope summary', scopeX + 14, row1Y + 12, { width: colB - 28 });

  const kpiY = row1Y + 34;
  const kpiW = (colB - 28 - 14) / 2;

  // KPI helper
  const kv = (x: number, y: number, w: number, label: string, value: string, align: 'left' | 'right' = 'left') => {
    doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(label, x, y, { width: w, align });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(value, x, y + 12, { width: w, align });
  };

  kv(scopeX + 14, kpiY, kpiW, 'Rooms', num0(computed.roomsFinal));
  kv(scopeX + 14 + kpiW + 14, kpiY, kpiW, 'Corridor sqft', num0(computed.corridorSqft));
  kv(scopeX + 14, kpiY + 40, colB - 28, 'Current cleaning frequency', computed.currentFreqLabel || '—');
  doc.restore();

  // ---------- Offers: 3 cards (NO annual totals, NO overflow) ----------
  const offersTitleY = row1Y + row1H + 16;

  doc.save();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text('Offers', left, offersTitleY, { width: W });
  doc.font('Helvetica').fontSize(9).fillColor(C.muted).text('Per-room rates shown below. Common areas billed per sqft as applicable.', left, offersTitleY + 16, {
    width: W
  });
  doc.restore();

  const cardsY = offersTitleY + 38;
  const cardGap = 12;
  const cardW = (W - cardGap * 2) / 3;
  const cardH = 108;

  const offerKeys = ['ondemand', 'partner', 'total'] as const;

  for (let i = 0; i < offerKeys.length; i++) {
    const key = offerKeys[i];
    const x = left + i * (cardW + cardGap);
    const isChosen = String(chosenKey) === key;
    const copy = offerCopy(key);
    const room = planRoom(key);

    doc.save();
    roundRect(x, cardsY, cardW, cardH, 16);
    doc.lineWidth(isChosen ? 2 : 1).strokeColor(isChosen ? C.brand : C.line).fillColor(C.card).fillAndStroke();

    drawBadge(x + 12, cardsY + 10, copy.badge);

    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(12).text(copy.title, x + 12, cardsY + 30, { width: cardW - 24 });
    doc.fillColor(C.muted).font('Helvetica').fontSize(9).text(copy.subtitle, x + 12, cardsY + 48, { width: cardW - 24 });

    // Single anchor price inside card (Both/room) — marketing-friendly, not annual
    doc.fillColor(C.muted).font('Helvetica').fontSize(9).text('Both / room', x + 12, cardsY + 70, { width: cardW - 24 });
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(18).text(money0(room.both), x + 12, cardsY + 82, { width: cardW - 24 });

    if (opts.acceptance && isChosen) {
      doc.fillColor(C.brand).font('Helvetica-Bold').fontSize(9).text('ACCEPTED', x + cardW - 78, cardsY + 12, { width: 66, align: 'right' });
    }

    doc.restore();
  }

  // ---------- Room pricing table (THIS is what you want) ----------
  const tableY = cardsY + cardH + 14;
  const tableX = left;
  const tableW = W;
  const headerH2 = 22;
  const rowH = 20;

  // Columns (sum to tableW)
  const cols = {
    offer: 170,
    carpet: 110,
    tile: 110,
    both: tableW - (170 + 110 + 110)
  };

  // Header baseline (IMPORTANT: fixed Y so it NEVER diagonalizes)
  const hy = tableY;

  doc.save();
  roundRect(tableX, hy, tableW, headerH2, 10);
  doc.fillColor(C.soft).fill();
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(9);
  doc.text('Room pricing (per room)', tableX + 12, hy + 6, { width: cols.offer - 12 });
  doc.text('Carpet', tableX + cols.offer, hy + 6, { width: cols.carpet - 10, align: 'right' });
  doc.text('Tile', tableX + cols.offer + cols.carpet, hy + 6, { width: cols.tile - 10, align: 'right' });
  doc.text('Both', tableX + cols.offer + cols.carpet + cols.tile, hy + 6, { width: cols.both - 10, align: 'right' });
  doc.restore();

  const rowStartY = hy + headerH2;

  const tableRow = (y: number, key: 'ondemand' | 'partner' | 'total') => {
    const isChosen = String(chosenKey) === key;
    const label = offerCopy(key).title;
    const room = planRoom(key);

    doc.save();
    doc.rect(tableX, y, tableW, rowH).lineWidth(isChosen ? 2 : 1).strokeColor(isChosen ? C.brand : C.line).stroke();

    doc.fillColor(C.ink).font('Helvetica').fontSize(9).text(label, tableX + 12, y + 6, { width: cols.offer - 12 });

    doc.font('Helvetica-Bold');
    doc.text(money0(room.carpet), tableX + cols.offer, y + 6, { width: cols.carpet - 10, align: 'right' });
    doc.text(money0(room.tile), tableX + cols.offer + cols.carpet, y + 6, { width: cols.tile - 10, align: 'right' });
    doc.text(money0(room.both), tableX + cols.offer + cols.carpet + cols.tile, y + 6, { width: cols.both - 10, align: 'right' });

    doc.restore();
  };

  tableRow(rowStartY + rowH * 0, 'ondemand');
  tableRow(rowStartY + rowH * 1, 'partner');
  tableRow(rowStartY + rowH * 2, 'total');

  // ---------- Info boxes (tight) ----------
  const infoY = rowStartY + rowH * 3 + 12;

  // Signature zone fixed at bottom
  const sigH = 92;
  const sigY = top + H - sigH;

  // Make sure info section never overlaps signature zone
  const maxInfoH = Math.max(70, sigY - 12 - infoY);
  const infoH = Math.min(96, maxInfoH);

  const infoGap = 14;
  const infoW = (W - infoGap) / 2;

  const incX = left;
  const procX = left + infoW + infoGap;

  drawCard(incX, infoY, infoW, infoH);
  drawCard(procX, infoY, infoW, infoH);

  doc.save();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text("What's included", incX + 14, infoY + 12, { width: infoW - 28 });
  doc.font('Helvetica').fontSize(9).fillColor(C.sub).text(
    [
      '• Tile & grout brushing + rinse/extraction',
      '• Carpet encapsulation + high-agitation brushing',
      '• Odor neutralizer when needed',
      '• Hotel-friendly, low-disruption workflow'
    ].join('\n'),
    incX + 14,
    infoY + 32,
    { width: infoW - 28, lineGap: 2 }
  );
  doc.restore();

  doc.save();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text('Process & timing', procX + 14, infoY + 12, { width: infoW - 28 });
  doc.font('Helvetica').fontSize(9).fillColor(C.sub).text(
    [
      '• Typical: 30–40 minutes per room',
      '• Areas usable after ~1 hour (airflow dependent)',
      '• Scheduling optimized to reduce downtime'
    ].join('\n'),
    procX + 14,
    infoY + 32,
    { width: infoW - 28, lineGap: 2 }
  );
  doc.fillColor(C.brand).font('Helvetica-Bold').fontSize(9).text('Next step: approve online to lock scheduling.', procX + 14, infoY + infoH - 22, {
    width: infoW - 28
  });
  doc.restore();

  // ---------- Signature / Acceptance (reserved fixed zone) ----------
  drawCard(left, sigY, W, sigH);

  doc.save();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text(opts.acceptance ? 'Digital signature (record)' : 'Approval', left + 14, sigY + 12, {
    width: W - 28
  });

  if (opts.acceptance) {
    const a = opts.acceptance;
    const lines = [
      `Signed by: ${a.signedByName}${a.signedByTitle ? ` (${a.signedByTitle})` : ''}`,
      `Email: ${a.signedByEmail}`,
      `Selected offer: ${offerCopy(chosenKey).title}`,
      `Timestamp (UTC): ${a.acceptedAt.toISOString()}`
    ];
    doc.font('Helvetica').fontSize(9).fillColor(C.sub).text(lines.join('\n'), left + 14, sigY + 32, { width: W - 28, lineGap: 2 });
  } else {
    const lines = [
      'This quote is an estimate. Final pricing may vary after on-site validation.',
      'Approval is completed online via digital signature. Once approved, we will confirm scheduling.'
    ];
    doc.font('Helvetica').fontSize(9).fillColor(C.sub).text(lines.join('\n'), left + 14, sigY + 32, { width: W - 28, lineGap: 2 });
  }

  doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(`${BRAND.name} • ${BRAND.phone} • ${BRAND.email}`, left + 14, sigY + sigH - 18, {
    width: W - 28,
    align: 'right'
  });

  doc.restore();

  doc.end();
  return done;
}