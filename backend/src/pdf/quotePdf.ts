import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { renderQuoteHtml, type QuotePayload } from './quoteHtml';

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
    acceptedPlanKey: 'ondemand' | 'partner' | 'total' | string;
    signedByName: string;
    signedByTitle: string;
    signedByEmail: string;
  } | null;
}) {
  // ---------- Data ----------
  const computed = computeFromPayload(opts.payload);
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
  const logoDataUri = readLogoDataUri();
  const html = renderQuoteHtml({
    brand: BRAND,
    logoDataUri,
    quoteNumber: opts.quoteNumber,
    nowLabel: now,
    customer: opts.customer,
    title: opts.title,
    payload: opts.payload,
    computed: {
      hotelName: computed.hotelName,
      hotelAddress: computed.hotelAddress,
      hotelTel: computed.hotelTel,
      hotelContact: computed.hotelContact,
      hotelEmail: computed.hotelEmail,
      roomsCalculated: computed.roomsCalculated,
      roomsFinal: computed.roomsFinal,
      corridorSqft: computed.corridorSqft,
      currentFreqLabel: computed.currentFreqLabel
    },
    acceptance: opts.acceptance
      ? {
          acceptedAt: opts.acceptance.acceptedAt,
          acceptedPlanKey: (opts.acceptance.acceptedPlanKey as any) || 'total',
          signedByName: opts.acceptance.signedByName,
          signedByTitle: opts.acceptance.signedByTitle,
          signedByEmail: opts.acceptance.signedByEmail
        }
      : null
  });

  const executablePath = findChromiumExecutable();
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true
    });
    await page.close();
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

function findChromiumExecutable(): string {
  const fromEnv = String(process.env.CHROMIUM_PATH || '').trim();
  const candidates = [
    fromEnv,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  throw new Error(
    'Chromium executable not found. Install Chromium/Chrome or set CHROMIUM_PATH. In Docker, install the `chromium` package.'
  );
}

let cachedLogoDataUri: string | null | undefined;
function readLogoDataUri() {
  if (cachedLogoDataUri !== undefined) return cachedLogoDataUri;
  const logoPath = findLogoPath();
  if (!logoPath) return (cachedLogoDataUri = null);
  try {
    const buf = fs.readFileSync(logoPath);
    cachedLogoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
    return cachedLogoDataUri;
  } catch {
    return (cachedLogoDataUri = null);
  }
}
