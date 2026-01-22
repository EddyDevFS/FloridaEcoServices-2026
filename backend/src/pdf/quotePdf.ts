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
  const chosen =
    chosenKey === 'ondemand'
      ? computed.offers.ondemand
      : chosenKey === 'partner'
        ? computed.offers.partner
        : computed.offers.total;

  const offerCopy = (key: string) =>
    key === 'ondemand'
      ? { title: 'On-Demand', subtitle: 'One-time or urgent requests', badge: '' }
      : key === 'partner'
        ? { title: 'Refresh Plan', subtitle: 'Yearly refresh for partial coverage', badge: 'BEST VALUE' }
        : { title: 'Total Care', subtitle: 'Full annual coverage + priority scheduling', badge: 'RECOMMENDED' };

  const money0 = (n: number) => {
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  };
  const money2 = (n: number) => {
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  };
  const num0 = (n: number) => {
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-US').format(Math.round(n));
  };

  // ---------- Layout constants (fixed 1-page grid) ----------
  const left = doc.page.margins.left;
  const top = doc.page.margins.top;
  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const H = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

  // Colors
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

  const r = (n: number) => Math.round(n);

  const roundRect = (x: number, y: number, w: number, h: number, radius = 12) => {
    doc.roundedRect(r(x), r(y), r(w), r(h), radius);
  };

  const hr = (y: number) => {
    doc.save();
    doc.moveTo(left, r(y)).lineTo(left + W, r(y)).lineWidth(1).strokeColor(C.line).stroke();
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

  const drawKeyValue = (x: number, y: number, w: number, label: string, value: string, align: 'left' | 'right' = 'left') => {
    doc.save();
    doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(label, x, y, { width: w, align });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(value, x, y + 12, { width: w, align });
    doc.restore();
  };

  const drawCard = (x: number, y: number, w: number, h: number) => {
    doc.save();
    roundRect(x, y, w, h, 14);
    doc.lineWidth(1).strokeColor(C.line).fillColor(C.card).fillAndStroke();
    doc.restore();
  };

  // ---------- Header (fixed) ----------
  const headerH = 86;
  const headerY = top;

  // thin brand bar
  doc.save();
  doc.rect(left, headerY, W, 3).fillColor(C.brand).fill();
  doc.restore();

  // Logo
  const logoPath = findLogoPath();
  const hasLogo = !!logoPath;
  const logoW = 120;
  const logoH = 44;

  if (logoPath) {
    try {
      doc.image(logoPath, left, headerY + 12, { fit: [logoW, logoH] });
    } catch {}
  }

  const titleX = left + (hasLogo ? logoW + 14 : 0);
  const titleW = W - (hasLogo ? logoW + 14 : 0) - 190;

  doc.save();
  doc.font('Helvetica-Bold').fontSize(18).fillColor(C.ink).text('Quote', titleX, headerY + 10, { width: titleW });
  doc.font('Helvetica').fontSize(10).fillColor(C.sub).text('Commercial carpet + tile & grout cleaning', titleX, headerY + 34, { width: titleW });

  // Brand contact (small)
  doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(
    `${BRAND.name} • ${BRAND.phone} • ${BRAND.email}`,
    titleX,
    headerY + 54,
    { width: titleW }
  );
  doc.restore();

  // Right meta box
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

  // ---------- Row 1: Customer + Scope summary ----------
  const row1Y = headerY + headerH + 14;
  const row1H = 92;

  const colGap = 14;
  const colA = (W - colGap) * 0.58;
  const colB = W - colGap - colA;

  const customerX = left;
  const scopeX = left + colA + colGap;

  drawCard(customerX, row1Y, colA, row1H);
  drawCard(scopeX, row1Y, colB, row1H);

  // Customer card
  doc.save();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text('Customer', customerX + 14, row1Y + 12, { width: colA - 28 });
  doc.font('Helvetica').fontSize(10).fillColor(C.ink);

  // Keep it tight: max 4 lines
  const custLines = [
    company || '—',
    contact || '',
    email || '',
    phone || '',
    computed.hotelAddress || ''
  ].filter(Boolean);

  doc.font('Helvetica').fontSize(10).fillColor(C.sub).text(custLines.slice(0, 4).join('\n'), customerX + 14, row1Y + 30, { width: colA - 28 });
  doc.restore();

  // Scope card (3 KPIs)
  doc.save();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text('Scope summary', scopeX + 14, row1Y + 12, { width: colB - 28 });

  const kpiY = row1Y + 34;
  const kpiW = (colB - 28 - 14) / 2;

  drawKeyValue(scopeX + 14, kpiY, kpiW, 'Rooms', num0(computed.roomsFinal));
  drawKeyValue(scopeX + 14 + kpiW + 14, kpiY, kpiW, 'Corridor sqft', num0(computed.corridorSqft));
  drawKeyValue(scopeX + 14, kpiY + 40, colB - 28, 'Current cleaning frequency', computed.currentFreqLabel || '—');
  doc.restore();

  // ---------- Row 2: Offer cards (3 across) ----------
  const row2Y = row1Y + row1H + 14;
  const row2H = 150;

  const cardGap = 12;
  const cardW = (W - cardGap * 2) / 3;

  const offerKeys = ['ondemand', 'partner', 'total'] as const;
  const offersMap = {
    ondemand: computed.offers.ondemand,
    partner: computed.offers.partner,
    total: computed.offers.total
  } as const;

  // Section title
  doc.save();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text('Offers', left, row2Y - 2, { width: W });
  doc.font('Helvetica').fontSize(9).fillColor(C.muted).text('Estimates include rooms + corridor/common areas based on provided scope.', left, row2Y + 14, { width: W });
  doc.restore();

  const cardsY = row2Y + 34;

  for (let i = 0; i < offerKeys.length; i++) {
    const key = offerKeys[i];
    const calc = offersMap[key];
    const x = left + i * (cardW + cardGap);
    const isChosen = String(chosenKey) === key;
    const copy = offerCopy(key);

    // Card shell (highlight chosen)
    doc.save();
    roundRect(x, cardsY, cardW, row2H - 34, 16);
    doc.lineWidth(isChosen ? 2 : 1).strokeColor(isChosen ? C.brand : C.line).fillColor(C.card).fillAndStroke();

    // Badge (best value/recommended)
    drawBadge(x + 12, cardsY + 10, copy.badge);

    // Title + subtitle
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(12).text(copy.title, x + 12, cardsY + 28, { width: cardW - 24 });
    doc.fillColor(C.muted).font('Helvetica').fontSize(9).text(copy.subtitle, x + 12, cardsY + 46, { width: cardW - 24 });

    // Price block
    const priceY = cardsY + 70;
    doc.fillColor(C.muted).font('Helvetica').fontSize(9).text('Avg price / room', x + 12, priceY, { width: cardW - 24 });
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(18).text(money0(calc.avgPerRoom), x + 12, priceY + 12, { width: cardW - 24 });

    // Totals
    const totalsY = cardsY + 108;
    doc.fillColor(C.sub).font('Helvetica').fontSize(9).text('Est. annual total', x + 12, totalsY, { width: cardW - 24 });
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(12).text(money0(calc.totalAnnual), x + 12, totalsY + 12, { width: cardW - 24 });

    // Small footer line
    doc.fillColor(C.muted).font('Helvetica').fontSize(8).text(
      `Rooms: ${money0(calc.roomsCost)}  •  Common areas: ${money0(calc.corridorCost)}`,
      x + 12,
      cardsY + 132,
      { width: cardW - 24 }
    );

    // “Selected” marker (if signature already accepted)
    if (opts.acceptance && isChosen) {
      doc.fillColor(C.brand).font('Helvetica-Bold').fontSize(9).text('ACCEPTED', x + cardW - 72, cardsY + 12, { width: 60, align: 'right' });
    }

    doc.restore();
  }

  // ---------- Row 3: What’s included + Process (2 columns) ----------
  const row3Y = cardsY + (row2H - 34) + 12;
  const row3H = 128;

  const col3A = (W - colGap) / 2;
  const col3B = col3A;

  const incX = left;
  const procX = left + col3A + colGap;

  drawCard(incX, row3Y, col3A, row3H);
  drawCard(procX, row3Y, col3B, row3H);

  // Included
  doc.save();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text('What’s included', incX + 14, row3Y + 12, { width: col3A - 28 });
  doc.font('Helvetica').fontSize(9).fillColor(C.sub).text(
    [
      '• Professional detergent & agitation',
      '• Tile & grout brushing + rinse/extraction',
      '• Carpet encapsulation + high-agitation brushing',
      '• Odor neutralizer included when needed',
      '• Commercial-grade fiber protectant (as applicable)'
    ].join('\n'),
    incX + 14,
    row3Y + 32,
    { width: col3A - 28, lineGap: 2 }
  );
  doc.restore();

  // Process & timing (tight + marketing)
  doc.save();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text('Process & timing', procX + 14, row3Y + 12, { width: col3B - 28 });
  doc.font('Helvetica').fontSize(9).fillColor(C.sub).text(
    [
      '• Fast, low-disruption workflow (hotel-friendly)',
      '• Typical: 30–40 minutes per room',
      '• Areas usable after ~1 hour (depending on airflow)',
      '• Scheduling optimized to reduce downtime'
    ].join('\n'),
    procX + 14,
    row3Y + 32,
    { width: col3B - 28, lineGap: 2 }
  );

  // CTA line
  doc.fillColor(C.brand).font('Helvetica-Bold').fontSize(9).text('Next step: approve online to lock pricing & schedule.', procX + 14, row3Y + row3H - 22, {
    width: col3B - 28
  });
  doc.restore();

  // ---------- Signature / Acceptance (reserved zone, fixed height) ----------
  const sigH = 92;
  const sigY = top + H - sigH; // fixed bottom zone (always exists)
  drawCard(left, sigY, W, sigH);

  doc.save();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text(opts.acceptance ? 'Digital signature (record)' : 'Approval', left + 14, sigY + 12, { width: W - 28 });

  if (opts.acceptance) {
    // Keep it compact to not overflow
    const a = opts.acceptance;
    const lines = [
      `Signed by: ${a.signedByName}${a.signedByTitle ? ` (${a.signedByTitle})` : ''}`,
      `Email: ${a.signedByEmail}`,
      `Accepted offer: ${offerCopy(chosenKey).title}`,
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

  // footer right contact
  doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(`${BRAND.name} • ${BRAND.phone} • ${BRAND.email}`, left + 14, sigY + sigH - 18, {
    width: W - 28,
    align: 'right'
  });

  doc.restore();

  // IMPORTANT: Do not add any pages; we keep strict 1-page layout
  doc.end();
  return done;
}