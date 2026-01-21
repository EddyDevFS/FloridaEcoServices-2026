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
    const corridorSqftPrice = Number(plan.corridorSqft) || 0;
    const billedRooms = Math.max(roomsFinal, minRooms);

    let roomsCost = 0;
    if (roomsFinal <= 0) roomsCost = 0;
    else if (mode === 'advanced' && mixOk) {
      roomsCost = mixCarpet * (Number(room.carpet) || 0) + mixTile * (Number(room.tile) || 0) + mixBoth * (Number(room.both) || 0);
      if (billedRooms > roomsFinal) roomsCost += (billedRooms - roomsFinal) * (Number(room.both) || 0);
    } else {
      roomsCost = billedRooms * (Number(room.both) || 0);
    }

    const corridorCost = corridorSqft * corridorSqftPrice;
    const totalAnnual = roomsCost + corridorCost;
    const avgPerRoom = billedRooms ? roomsCost / billedRooms : 0;

    return { roomsCost, corridorCost, totalAnnual, avgPerRoom, billedRooms };
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

  const computed = computeFromPayload(opts.payload);
  const quoteNo = opts.quoteNumber ? `#${opts.quoteNumber}` : '';
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });

  const company = String(opts.customer?.company || computed.hotelName || opts.title || '').trim();
  const contact = String(opts.customer?.contact || computed.hotelContact || '').trim();
  const email = String(opts.customer?.email || computed.hotelEmail || '').trim();
  const phone = String(opts.customer?.phone || computed.hotelTel || '').trim();

  const left = doc.page.margins.left;
  const top = doc.page.margins.top;
  const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const rightW = 220;
  const logoW = 120;
  const logoH = 64;
  const gap = 14;

  const offerCopy = (key: string) =>
    key === 'ondemand'
      ? { title: 'On‑Demand', subtitle: 'One‑time or urgent requests' }
      : key === 'partner'
        ? { title: 'Refresh Plan', subtitle: 'Planned yearly refresh (best value for partial coverage)' }
        : { title: 'Total Care', subtitle: 'Full annual coverage + priority scheduling' };

  const logoPath = findLogoPath();
  const hasLogo = !!logoPath;

  if (logoPath) {
    try {
      doc.image(logoPath, left, top, { fit: [logoW, logoH] });
    } catch {}
  }

  const leftTextX = left + (hasLogo ? logoW + gap : 0);
  const leftTextW = contentW - (hasLogo ? logoW + gap : 0) - rightW;
  const rightX = left + contentW - rightW;

  // Right header: document identity
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#111827').text('Quote', rightX, top, { width: rightW, align: 'right' });
  doc.fontSize(10)
    .font('Helvetica')
    .fillColor('#374151')
    .text([quoteNo, now].filter(Boolean).join(' · '), rightX, top + 26, { width: rightW, align: 'right' });

  // Left header: brand + contact
  doc.fontSize(14).font('Helvetica-Bold').fillColor('#111827').text(BRAND.name, leftTextX, top + 2, {
    width: leftTextW
  });
  doc.fontSize(9)
    .font('Helvetica')
    .fillColor('#374151')
    .text(BRAND.address1, leftTextX, top + 20, { width: leftTextW })
    .text(BRAND.address2, leftTextX, top + 32, { width: leftTextW })
    .text(`${BRAND.contactName} · ${BRAND.contactTitle}`, leftTextX, top + 44, { width: leftTextW })
    .text(`${BRAND.phone} · ${BRAND.email}`, leftTextX, top + 56, { width: leftTextW });

  // Divider
  const headerBottom = top + 84;
  doc.save();
  doc
    .moveTo(left, headerBottom)
    .lineTo(left + contentW, headerBottom)
    .lineWidth(1)
    .strokeColor('#e5e7eb')
    .stroke();
  doc.restore();

  doc.y = headerBottom + 16;
  doc.fillColor('#111827');

  doc.fontSize(11).font('Helvetica-Bold').text('Customer');
  doc.fontSize(10).font('Helvetica');
  if (company) doc.text(company);
  if (contact) doc.text(contact);
  if (email) doc.text(email);
  if (phone) doc.text(phone);
  if (computed.hotelAddress) doc.text(computed.hotelAddress);
  doc.moveDown(0.9);

  const boxGap = 16;
  const boxTop = doc.y;
  const boxW = (contentW - boxGap) / 2;
  const boxH = 76;
  const leftBoxX = left;
  const rightBoxX = left + boxW + boxGap;

  const drawBox = (x: number, y: number, title: string, lines: Array<[string, string]>) => {
    doc.save();
    doc.roundedRect(x, y, boxW, boxH, 10).lineWidth(1).strokeColor('#e5e7eb').fillColor('#ffffff').fillAndStroke();
    doc.fillColor('#111827').fontSize(10).font('Helvetica-Bold').text(title, x + 12, y + 10, { width: boxW - 24 });
    let yy = y + 28;
    doc.font('Helvetica').fontSize(10).fillColor('#374151');
    for (const [k, v] of lines) {
      const valueW = 140;
      const keyW = boxW - 24 - valueW;
      doc.text(k, x + 12, yy, { width: keyW });
      doc.fillColor('#111827').font('Helvetica-Bold').text(v, x + 12 + keyW, yy, { width: valueW, align: 'right' });
      doc.fillColor('#374151').font('Helvetica');
      yy += 16;
    }
    doc.restore();
  };

  drawBox(leftBoxX, boxTop, 'Scope', [
    ['Rooms', num(computed.roomsFinal)],
    ['Corridor sqft', num(computed.corridorSqft)],
    ['Current frequency', computed.currentFreqLabel]
  ]);

  const acceptedKey = String(opts.acceptance?.acceptedPlanKey || '').trim();
  const chosenKey = acceptedKey || 'total';
  const chosen =
    chosenKey === 'ondemand'
      ? computed.offers.ondemand
      : chosenKey === 'partner'
        ? computed.offers.partner
        : computed.offers.total;
  const chosenLabel = offerCopy(chosenKey).title;

  drawBox(rightBoxX, boxTop, opts.acceptance ? 'Accepted offer' : 'Recommended offer', [
    ['Offer', chosenLabel],
    ['Price / room', money(chosen.avgPerRoom)]
  ]);

  doc.y = boxTop + boxH + 18;

  doc.fontSize(11).font('Helvetica-Bold').fillColor('#111827').text('Offers');
  doc.moveDown(0.4);

  const tableX = left;
  const tableW = contentW;
  const colCheck = 26;
  const colPlan = 320;
  const colPrice = tableW - colCheck - colPlan;

  const headerH = 22;
  const rowH = 34;
  const headerY = doc.y;
  doc.save();
  doc.roundedRect(tableX, headerY, tableW, headerH, 8).fillColor('#f3f4f6').fill();
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10);
  doc.text('Select', tableX + 10, headerY + 6, { width: colCheck - 10 });
  doc.text('Offer', tableX + colCheck, headerY + 6, { width: colPlan - 10 });
  doc.text('Price / room', tableX + colCheck + colPlan, headerY + 6, { width: colPrice - 10, align: 'right' });
  doc.restore();

  const rows = [
    ['ondemand', computed.offers.ondemand],
    ['partner', computed.offers.partner],
    ['total', computed.offers.total]
  ] as const;

  let y = headerY + headerH;
  for (const [planKey, calc] of rows) {
    const isChosen = !!opts.acceptance && String(opts.acceptance.acceptedPlanKey || '') === planKey;
    doc.save();
    doc
      .rect(tableX, y, tableW, rowH)
      .lineWidth(isChosen ? 2 : 1)
      .strokeColor(isChosen ? '#0b6b55' : '#e5e7eb')
      .stroke();

    // checkbox
    const cx = tableX + 10;
    const cy = y + 6;
    doc.rect(cx, cy, 10, 10).lineWidth(1).strokeColor(isChosen ? '#0b6b55' : '#9ca3af').stroke();
    if (isChosen) {
      doc
        .moveTo(cx + 2, cy + 6)
        .lineTo(cx + 4.5, cy + 9)
        .lineTo(cx + 9, cy + 2)
        .lineWidth(2)
        .strokeColor('#0b6b55')
        .stroke();
    }

    const copy = offerCopy(planKey);
    doc.fillColor('#111827').font('Helvetica').fontSize(10).text(copy.title, tableX + colCheck, y + 6, { width: colPlan - 10 });
    doc.fillColor('#6b7280').font('Helvetica').fontSize(8).text(copy.subtitle, tableX + colCheck, y + 19, {
      width: colPlan - 10
    });
    doc.fillColor('#111827')
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(money(calc.avgPerRoom), tableX + colCheck + colPlan, y + 6, { width: colPrice - 10, align: 'right' });
    doc.restore();
    y += rowH;
  }

  doc.moveDown(0.8);
  doc.fontSize(9)
    .font('Helvetica')
    .fillColor('#6b7280')
    .text('This quote is an estimate. Final pricing may vary after on-site validation.');

  if (opts.acceptance) {
    doc.moveDown(1.1);
    doc.save();
    const boxY = doc.y;
    doc.roundedRect(tableX, boxY, tableW, 86, 10).lineWidth(1).strokeColor('#e5e7eb').fillColor('#ffffff').fillAndStroke();
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10).text('Digital signature', tableX + 12, boxY + 10, { width: tableW - 24 });
    doc.fillColor('#374151').font('Helvetica').fontSize(9);
    doc.text(`Signed by: ${opts.acceptance.signedByName} (${opts.acceptance.signedByTitle})`, tableX + 12, boxY + 28, {
      width: tableW - 24
    });
    doc.text(`Email: ${opts.acceptance.signedByEmail}`, tableX + 12, boxY + 42, { width: tableW - 24 });
    doc.text(`Timestamp (UTC): ${opts.acceptance.acceptedAt.toISOString()}`, tableX + 12, boxY + 56, { width: tableW - 24 });
    doc.text(`Selected offer: ${chosenLabel}`, tableX + 12, boxY + 70, { width: tableW - 24 });
    doc.restore();
  }

  doc.end();
  return done;
}
