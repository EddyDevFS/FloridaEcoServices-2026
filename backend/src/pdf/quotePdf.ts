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
  email: 'eddy@floridaecoservices.com',
  website: 'floridaecoservices.com'
};

function findLogoPath() {
  const filename = 'logo-florida-eco-services.png';
  const candidates = [
    path.resolve(process.cwd(), 'assets', filename),
    path.resolve(process.cwd(), 'backend', 'assets', filename),
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
      '1/year': 'Once per year',
      '2/year': 'Twice per year',
      '3/year': 'Three times per year',
      quarterly: 'Quarterly',
      monthly: 'Monthly',
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

  const COLORS = {
    text: '#111827',
    muted: '#6b7280',
    line: '#e5e7eb',
    brand: '#0b6b55'
  } as const;

  const left = doc.page.margins.left;
  const top = doc.page.margins.top;
  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;
  const ensureSpace = (h: number) => {
    if (doc.y + h > pageBottom()) doc.addPage();
  };

  const drawHRule = (y: number) => {
    doc.save();
    doc.moveTo(left, y).lineTo(left + W, y).lineWidth(1).strokeColor(COLORS.line).stroke();
    doc.restore();
  };

  const usd2 = (n: number) => {
    if (!Number.isFinite(n)) return '—';
    return `$${Number(n).toFixed(2)}`;
  };

  // ---------- Data ----------
  const computed = computeFromPayload(opts.payload);
  const quoteNo = opts.quoteNumber ? `#${opts.quoteNumber}` : '';
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });

  const company = String(opts.customer?.company || computed.hotelName || opts.title || '').trim();
  const contact = String(opts.customer?.contact || computed.hotelContact || '').trim();
  const email = String(opts.customer?.email || computed.hotelEmail || '').trim();
  const phone = String(opts.customer?.phone || computed.hotelTel || '').trim();

  const acceptedKey = String(opts.acceptance?.acceptedPlanKey || '').trim();

  const rawPlans = (opts.payload && typeof opts.payload === 'object' ? (opts.payload as any).pricing?.plans : null) || {};
  const planRoom = (key: 'ondemand' | 'partner' | 'total') => {
    const plan = rawPlans?.[key] || {};
    const room = plan.room || {};
    return { carpet: Number(room.carpet) || 0, tile: Number(room.tile) || 0, both: Number(room.both) || 0 };
  };
  const planSqft = (key: 'ondemand' | 'partner' | 'total') => {
    const plan = rawPlans?.[key] || {};
    return {
      carpetSqft: Number((plan as any).carpetSqft ?? (plan as any).carpetSqftPrice ?? (plan as any).corridorSqft) || 0,
      tileSqft: Number((plan as any).tileSqft ?? (plan as any).tileSqftPrice ?? (plan as any).corridorSqft) || 0
    };
  };

  const offerCopy = (key: 'ondemand' | 'partner' | 'total') => {
    if (key === 'ondemand') return { title: 'On‑Demand', condition: 'No obligation / no commitment.' };
    if (key === 'partner') return { title: 'Refresh Plan', condition: 'Minimum 50% of rooms completed within 6 months.' };
    return { title: 'Total Care', condition: 'Minimum 90% of rooms completed within 6 months.' };
  };

  // ---------- Header ----------
  const logoPath = findLogoPath();
  const logoW = 140;
  const logoH = 48;

  if (logoPath) {
    try {
      doc.image(logoPath, left, top, { fit: [logoW, logoH] });
    } catch {}
  }

  const headerRightW = 220;
  const headerRightX = left + W - headerRightW;

  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(22).text('Quote', headerRightX, top, {
    width: headerRightW,
    align: 'right'
  });
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(10).text([quoteNo, now].filter(Boolean).join(' • '), headerRightX, top + 26, {
    width: headerRightW,
    align: 'right'
  });

  const headerLeftX = left + (logoPath ? logoW + 12 : 0);
  const headerLeftW = W - (logoPath ? logoW + 12 : 0) - headerRightW - 10;
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(12).text(BRAND.name, headerLeftX, top + 2, { width: headerLeftW });
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(9)
    .text(BRAND.address1, headerLeftX, top + 18, { width: headerLeftW })
    .text(BRAND.address2, headerLeftX, top + 30, { width: headerLeftW })
    .text(`${BRAND.phone} • ${BRAND.email} • ${BRAND.website}`, headerLeftX, top + 42, { width: headerLeftW });

  const headerBottomY = top + 64;
  drawHRule(headerBottomY);
  doc.y = headerBottomY + 14;

  // ---------- Customer ----------
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(11).text('Customer');
  doc.fillColor(COLORS.text).font('Helvetica').fontSize(10);
  if (company) doc.text(company);
  if (contact) doc.text(contact);
  if (email) doc.text(email);
  if (phone) doc.text(phone);
  if (computed.hotelAddress) doc.text(computed.hotelAddress);
  doc.moveDown(0.8);

  // ---------- Scope ----------
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(11).text('Scope');
  const scopeTableY = doc.y + 8;
  const scopeRowH = 18;
  const scopeX = left;
  const scopeW = W;
  const kW = 190;
  const vW = scopeW - kW;
  const scopeRows: Array<[string, string]> = [
    ['Rooms', num(computed.roomsFinal)],
    ['Corridor sqft', num(computed.corridorSqft)],
    ['Current cleaning frequency', computed.currentFreqLabel || '—']
  ];
  doc.save();
  doc.roundedRect(scopeX, scopeTableY, scopeW, scopeRowH * scopeRows.length + 12, 10).lineWidth(1).strokeColor(COLORS.line).stroke();
  doc.restore();
  let sy = scopeTableY + 8;
  for (const [k, v] of scopeRows) {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text(k, scopeX + 12, sy, { width: kW - 12 });
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(9).text(v, scopeX + kW, sy, { width: vW - 12, align: 'right' });
    sy += scopeRowH;
  }
  doc.y = scopeTableY + scopeRowH * scopeRows.length + 18;

  // ---------- Plans & Pricing ----------
  ensureSpace(220);
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(11).text('Plans & pricing');
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text('Fixed pricing per room + per sqft for common areas.', { width: W });
  doc.moveDown(0.5);

  const tableX = left;
  const tableW = W;
  const headH = 22;
  const rowH = 22;
  const colPlan = 132;
  const colCarpetRoom = 76;
  const colTileRoom = 76;
  const colBothRoom = 76;
  const colCarpetSqft = 80;
  const colTileSqft = tableW - (colPlan + colCarpetRoom + colTileRoom + colBothRoom + colCarpetSqft);

  const tableY = doc.y;
  doc.save();
  doc.roundedRect(tableX, tableY, tableW, headH, 10).fillColor('#f3f4f6').fill();
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(9);
  doc.text('Plan', tableX + 10, tableY + 7, { width: colPlan - 10 });
  doc.text('Carpet/room', tableX + colPlan, tableY + 7, { width: colCarpetRoom, align: 'right' });
  doc.text('Tile/room', tableX + colPlan + colCarpetRoom, tableY + 7, { width: colTileRoom, align: 'right' });
  doc.text('Both/room', tableX + colPlan + colCarpetRoom + colTileRoom, tableY + 7, { width: colBothRoom, align: 'right' });
  doc.text('Carpet $/sqft', tableX + colPlan + colCarpetRoom + colTileRoom + colBothRoom, tableY + 7, { width: colCarpetSqft, align: 'right' });
  doc.text('Tile $/sqft', tableX + colPlan + colCarpetRoom + colTileRoom + colBothRoom + colCarpetSqft, tableY + 7, {
    width: colTileSqft - 10,
    align: 'right'
  });
  doc.restore();

  const planKeys: Array<'ondemand' | 'partner' | 'total'> = ['ondemand', 'partner', 'total'];
  let ry = tableY + headH;
  for (const key of planKeys) {
    const copy = offerCopy(key);
    const room = planRoom(key);
    const sqft = planSqft(key);
    const isAccepted = !!opts.acceptance && acceptedKey === key;

    doc.save();
    doc.rect(tableX, ry, tableW, rowH).lineWidth(isAccepted ? 2 : 1).strokeColor(isAccepted ? COLORS.brand : COLORS.line).stroke();
    doc.fillColor(COLORS.text).font('Helvetica').fontSize(9).text(copy.title, tableX + 10, ry + 6, { width: colPlan - 10 });
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(9);
    doc.text(money(room.carpet), tableX + colPlan, ry + 6, { width: colCarpetRoom, align: 'right' });
    doc.text(money(room.tile), tableX + colPlan + colCarpetRoom, ry + 6, { width: colTileRoom, align: 'right' });
    doc.text(money(room.both), tableX + colPlan + colCarpetRoom + colTileRoom, ry + 6, { width: colBothRoom, align: 'right' });
    doc.text(usd2(sqft.carpetSqft), tableX + colPlan + colCarpetRoom + colTileRoom + colBothRoom, ry + 6, {
      width: colCarpetSqft,
      align: 'right'
    });
    doc.text(usd2(sqft.tileSqft), tableX + colPlan + colCarpetRoom + colTileRoom + colBothRoom + colCarpetSqft, ry + 6, {
      width: colTileSqft - 10,
      align: 'right'
    });
    doc.restore();
    ry += rowH;
  }
  doc.y = ry + 10;

  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text('Note: "Both" applies when a room includes carpet + tile surfaces.', {
    width: W
  });
  doc.moveDown(0.6);

  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text('Plan conditions:', { width: W });
  doc.moveDown(0.2);
  for (const key of planKeys) {
    const c = offerCopy(key);
    doc.text(`• ${c.title}: ${c.condition}`, { width: W });
  }
  doc.moveDown(0.8);

  // ---------- Service & marketing ----------
  ensureSpace(170);
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(11).text('Service & process');
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(9)
    .text('Designed for hotel operations: fast turnaround, consistent results, and minimal disruption.', { width: W });
  doc.moveDown(0.4);

  const colGap = 18;
  const colW = (W - colGap) / 2;
  const col1X = left;
  const col2X = left + colW + colGap;
  const startY = doc.y;

  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(10).text('Tile & grout', col1X, startY, { width: colW });
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9);
  doc.text('• Detergent solution', col1X, startY + 14, { width: colW });
  doc.text('• Hard stiff brushing', col1X, startY + 28, { width: colW });
  doc.text('• 1200 PSI rinse / extraction', col1X, startY + 42, { width: colW });

  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(10).text('Carpet cleaning', col2X, startY, { width: colW });
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9);
  doc.text('• Detergent Pro Encapsulation', col2X, startY + 14, { width: colW });
  doc.text('• Odor neutralizer', col2X, startY + 28, { width: colW });
  doc.text('• High-agitation brushing process', col2X, startY + 42, { width: colW });
  doc.text('• Commercial fiber protectant', col2X, startY + 56, { width: colW });

  doc.y = startY + 78;
  doc.fillColor(COLORS.brand).font('Helvetica-Bold').fontSize(9).text('30–40 minutes per room • Ready after ~1 hour', left, doc.y, {
    width: W,
    align: 'center'
  });
  doc.moveDown(1.2);

  // ---------- Terms ----------
  ensureSpace(120);
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(11).text('Terms');
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(9)
    .text(
      'Pricing is subject to the agreed scope and conditions. Final quantities and any special constraints may be confirmed after on-site validation.',
      { width: W }
    );
  doc.moveDown(0.9);

  // ---------- Signature / status ----------
  if (opts.acceptance) {
    ensureSpace(86);
    doc.save();
    const boxY = doc.y;
    doc.roundedRect(left, boxY, W, 78, 10).lineWidth(1).strokeColor(COLORS.line).fillColor('#ffffff').fillAndStroke();
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(10).text('Digital signature', left + 12, boxY + 10, { width: W - 24 });
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9);
    doc.text(`Signed by: ${opts.acceptance.signedByName} (${opts.acceptance.signedByTitle})`, left + 12, boxY + 28, { width: W - 24 });
    doc.text(`Email: ${opts.acceptance.signedByEmail}`, left + 12, boxY + 42, { width: W - 24 });
    doc.text(`Timestamp (UTC): ${opts.acceptance.acceptedAt.toISOString()}`, left + 12, boxY + 56, { width: W - 24 });
    doc.restore();
  } else {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text('To approve: choose a plan and sign digitally using the secure link.', { width: W });
  }

  doc.end();
  return done;
}
