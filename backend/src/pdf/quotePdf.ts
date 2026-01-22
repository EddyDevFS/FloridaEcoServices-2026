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
  const doc = new PDFDocument({ 
    size: 'LETTER', 
    margin: 36,
    bufferPages: true
  });
  
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
      ? { 
          title: 'On-Demand', 
          subtitle: 'One-time cleaning as needed', 
          badge: 'FLEXIBLE',
          color: '#3B82F6',
          icon: '⚡'
        }
      : key === 'partner'
        ? { 
            title: 'Refresh Plan', 
            subtitle: 'Regular maintenance program', 
            badge: 'RECOMMENDED',
            color: '#10B981',
            icon: '🔄'
          }
        : { 
            title: 'Total Care', 
            subtitle: 'Complete peace of mind', 
            badge: "POPULAR",
            color: '#8B5CF6',
            icon: '🏆'
          };

  const money0 = (n: number) => {
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  };
  
  const num0 = (n: number) => {
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-US').format(Math.round(n));
  };

  const rawPlans = (opts.payload && typeof opts.payload === 'object' ? (opts.payload as any).pricing?.plans : null) || {};

  const planRoom = (key: string) => {
    const plan = rawPlans?.[key] || {};
    const room = plan.room || {};
    return {
      carpet: Number(room.carpet) || 0,
      tile: Number(room.tile) || 0,
      both: Number(room.both) || 0
    };
  };

  // ---------- Layout constants ----------
  const left = doc.page.margins.left;
  const top = doc.page.margins.top;
  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const H = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

  // Modern color palette
  const C = {
    // Brand colors
    primary: '#0B6B55',         // Florida Eco Services green
    primaryLight: '#E7F7F1',
    secondary: '#F59E0B',       // Accent orange
    accent: '#3B82F6',          // Blue for CTAs
    
    // Neutrals
    dark: '#111827',
    grayDark: '#374151',
    gray: '#6B7280',
    grayLight: '#E5E7EB',
    grayLighter: '#F3F4F6',
    white: '#FFFFFF',
    
    // Status colors
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6'
  };

  const rr = (x: number) => Math.round(x);

  // ---------- Helper functions ----------
  const roundRect = (x: number, y: number, w: number, h: number, radius = 8) => {
    doc.roundedRect(rr(x), rr(y), rr(w), rr(h), radius);
  };

  const drawGradientCard = (x: number, y: number, w: number, h: number, color1 = C.white, color2 = C.grayLighter) => {
    doc.save();
    
    // Create gradient
    const gradient = doc.linearGradient(x, y, x, y + h);
    gradient.stop(0, color1);
    gradient.stop(1, color2);
    
    roundRect(x, y, w, h, 12);
    doc.fill(gradient);
    
    // Subtle border
    doc.lineWidth(0.5);
    doc.strokeColor(C.grayLight);
    doc.stroke();
    
    doc.restore();
  };

  const drawBadge = (x: number, y: number, label: string, color = C.primary) => {
    if (!label) return;
    
    doc.save();
    doc.font('Helvetica-Bold').fontSize(7);
    
    const padX = 8, padY = 3;
    const w = doc.widthOfString(label) + padX * 2;
    const h = 16;
    
    roundRect(x, y, w, h, 20);
    doc.fillColor(color + '20'); // 20% opacity
    doc.fill();
    
    doc.fillColor(color);
    doc.text(label, x + padX, y + padY, { 
      width: w - padX * 2, 
      align: 'center',
      characterSpacing: 0.3
    });
    
    doc.restore();
  };

  const drawSectionHeader = (text: string, y: number) => {
    doc.save();
    
    // Background accent
    doc.rect(left, y - 4, 4, 20)
       .fillColor(C.primary)
       .fill();
    
    // Text
    doc.font('Helvetica-Bold')
       .fontSize(14)
       .fillColor(C.dark)
       .text(text, left + 12, y, {
         width: W - 12
       });
    
    doc.restore();
  };

  // ---------- HEADER (Modern) ----------
  const headerH = 100;
  
  // Header background
  doc.save();
  const headerGradient = doc.linearGradient(left, top, left + W, top + headerH);
  headerGradient.stop(0, C.primary);
  headerGradient.stop(1, C.primary + 'DD');
  doc.rect(left, top, W, headerH).fill(headerGradient);
  doc.restore();

  // Logo
  const logoPath = findLogoPath();
  const hasLogo = !!logoPath;
  const logoW = 140, logoH = 40;
  
	  if (logoPath) {
	    try { 
	      doc.image(logoPath, left + 20, top + 20, { 
	        fit: [logoW, logoH]
	      }); 
	    } catch {}
	  }

  // Quote info (right aligned)
  const quoteInfoX = left + W - 200;
  
  doc.save();
  roundRect(quoteInfoX, top + 20, 180, 60, 8);
  doc.fillColor(C.white + '20').fill();
  
  doc.fillColor(C.white)
     .font('Helvetica-Bold')
     .fontSize(10)
     .text('QUOTE PROPOSAL', quoteInfoX + 12, top + 30, {
       width: 156,
       characterSpacing: 1
     });
  
  doc.font('Helvetica')
     .fontSize(20)
     .text(quoteNo || 'NEW', quoteInfoX + 12, top + 45, {
       width: 156
     });
  
  doc.font('Helvetica')
     .fontSize(9)
     .text(`Date: ${now}`, quoteInfoX + 12, top + 70, {
       width: 156
     });
  
  doc.restore();

  // Header text
  const headerTextX = hasLogo ? left + logoW + 30 : left + 20;
  const headerTextW = W - (hasLogo ? logoW + 30 : 20) - 200;
  
  doc.save();
  doc.fillColor(C.white)
     .font('Helvetica-Bold')
     .fontSize(24)
     .text('Elevate Your Hotel\'s Cleanliness', headerTextX, top + 20, {
       width: headerTextW
     });
  
	  doc.font('Helvetica')
	     .fontSize(11)
	     .fillColor(C.white + 'E6')
	     .text('Professional Carpet & Tile Cleaning Solutions', headerTextX, top + 50, {
	       width: headerTextW
	     });
	  
	  doc.font('Helvetica')
	     .fontSize(9)
	     .fillColor(C.white + 'CC')
	     .text(`${BRAND.phone} • ${BRAND.email}`, headerTextX, top + 70, {
	       width: headerTextW
	     });
  
  doc.restore();

  // ---------- CUSTOMER & SCOPE SECTION ----------
  const section1Y = top + headerH + 24;
  
  drawSectionHeader('Project Details', section1Y);
  
  const section1ContentY = section1Y + 28;
  const section1H = 90;
  
  // Customer card
  const customerCardW = W * 0.5 - 10;
  drawGradientCard(left, section1ContentY, customerCardW, section1H);
  
  doc.save();
  doc.fillColor(C.dark)
     .font('Helvetica-Bold')
     .fontSize(10)
     .text('HOTEL INFORMATION', left + 16, section1ContentY + 16);
  
  doc.fillColor(C.grayDark)
     .font('Helvetica-Bold')
     .fontSize(12)
     .text(company || 'Hotel Name', left + 16, section1ContentY + 34, {
       width: customerCardW - 32
     });
  
  const contactLines = [
    contact ? `Contact: ${contact}` : null,
    email ? `Email: ${email}` : null,
    phone ? `Phone: ${phone}` : null
  ].filter(Boolean);
  
  doc.font('Helvetica')
     .fontSize(9)
     .fillColor(C.gray)
     .text(contactLines.join('\n'), left + 16, section1ContentY + 54, {
       width: customerCardW - 32,
       lineGap: 4
     });
  
  doc.restore();
  
  // Scope card
  const scopeCardX = left + customerCardW + 20;
  const scopeCardW = W - customerCardW - 20;
  drawGradientCard(scopeCardX, section1ContentY, scopeCardW, section1H);
  
  doc.save();
  doc.fillColor(C.dark)
     .font('Helvetica-Bold')
     .fontSize(10)
     .text('PROJECT SCOPE', scopeCardX + 16, section1ContentY + 16);
  
  // Metrics in grid
  const metricY = section1ContentY + 38;
  const metricW = (scopeCardW - 32) / 3;
  
  const drawMetric = (x: number, y: number, label: string, value: string, subtext = '') => {
    doc.fillColor(C.primary)
       .font('Helvetica-Bold')
       .fontSize(18)
       .text(value, x, y, {
         width: metricW,
         align: 'center'
       });
    
    doc.fillColor(C.gray)
       .font('Helvetica')
       .fontSize(8)
       .text(label, x, y + 24, {
         width: metricW,
         align: 'center'
       });
    
    if (subtext) {
      doc.fillColor(C.grayDark)
         .font('Helvetica')
         .fontSize(7)
         .text(subtext, x, y + 36, {
           width: metricW,
           align: 'center'
         });
    }
  };
  
  drawMetric(scopeCardX + 16, metricY, 'ROOMS', num0(computed.roomsFinal));
  drawMetric(scopeCardX + 16 + metricW, metricY, 'CORRIDOR SQFT', num0(computed.corridorSqft));
  drawMetric(
    scopeCardX + 16 + metricW * 2, 
    metricY, 
    'FREQUENCY', 
    computed.currentFreqLabel || '—',
    'Current cleaning'
  );
  
  doc.restore();

  // ---------- OFFERS SECTION ----------
  const offersSectionY = section1ContentY + section1H + 32;
  
  drawSectionHeader('Choose Your Cleaning Plan', offersSectionY);
  
  const offersDescY = offersSectionY + 28;
  
  doc.save();
  doc.fillColor(C.grayDark)
     .font('Helvetica')
     .fontSize(10)
     .text('Select the plan that best fits your needs. All prices are per room unless otherwise specified.', 
           left, offersDescY, {
             width: W,
             lineGap: 4
           });
  doc.restore();
  
  // Offers cards
  const cardsY = offersDescY + 20;
  const cardGap = 16;
  const cardW = (W - cardGap * 2) / 3;
  const cardH = 140;
  
  const offerKeys = ['ondemand', 'partner', 'total'] as const;
  
  for (let i = 0; i < offerKeys.length; i++) {
    const key = offerKeys[i];
    const x = left + i * (cardW + cardGap);
    const isChosen = String(chosenKey) === key;
    const copy = offerCopy(key);
    const room = planRoom(key);
    
    doc.save();
    
    // Card with shadow effect
    if (isChosen) {
      // Highlight chosen plan
      roundRect(x - 2, cardsY - 2, cardW + 4, cardH + 4, 14);
      doc.fillColor(copy.color + '20').fill();
      
      doc.lineWidth(2);
      doc.strokeColor(copy.color);
      doc.stroke();
    }
    
    // Main card
    drawGradientCard(x, cardsY, cardW, cardH);
    
    // Badge
    drawBadge(x + 16, cardsY + 16, copy.badge, copy.color);
    
    // Icon and title
    doc.fillColor(C.dark)
       .font('Helvetica-Bold')
       .fontSize(18)
       .text(`${copy.icon} ${copy.title}`, x + 16, cardsY + 38, {
         width: cardW - 32
       });
    
    // Subtitle
    doc.fillColor(C.gray)
       .font('Helvetica')
       .fontSize(9)
       .text(copy.subtitle, x + 16, cardsY + 62, {
         width: cardW - 32
       });
    
    // Price highlight
    const priceY = cardsY + 88;
    
    // Price background accent
    doc.rect(x, priceY - 8, cardW, 40)
       .fillColor(copy.color + '10')
       .fill();
    
    // Price
    doc.fillColor(C.dark)
       .font('Helvetica-Bold')
       .fontSize(20)
       .text(money0(room.both), x + 16, priceY, {
         width: cardW - 32
       });
    
    doc.fillColor(C.gray)
       .font('Helvetica')
       .fontSize(8)
       .text('Per room / both surfaces', x + 16, priceY + 24, {
         width: cardW - 32
       });
    
    // Accepted indicator
    if (opts.acceptance && isChosen) {
      doc.fillColor(C.success)
         .font('Helvetica-Bold')
         .fontSize(9)
         .text('✓ ACCEPTED', x + cardW - 76, cardsY + 16, {
           width: 60,
           align: 'right'
         });
    }
    
    doc.restore();
  }

  // ---------- PRICING DETAILS TABLE ----------
  const tableY = cardsY + cardH + 32;
  
  drawSectionHeader('Detailed Pricing', tableY);
  
  const tableContentY = tableY + 28;
  const headerH2 = 28;
  const rowH = 26;
  
  // Table header
  doc.save();
  roundRect(left, tableContentY, W, headerH2, 8);
  doc.fillColor(C.primaryLight).fill();
  
  doc.fillColor(C.primary)
     .font('Helvetica-Bold')
     .fontSize(10)
     .text('PLAN', left + 16, tableContentY + 8, {
       width: 150
     });
  
  doc.text('CARPET / ROOM', left + 166, tableContentY + 8, {
    width: 110,
    align: 'right'
  });
  
  doc.text('TILE / ROOM', left + 286, tableContentY + 8, {
    width: 110,
    align: 'right'
  });
  
  doc.text('BOTH / ROOM', left + 406, tableContentY + 8, {
    width: W - 406 - 16,
    align: 'right'
  });
  
  doc.restore();
  
  // Table rows
  const rowStartY = tableContentY + headerH2;
  
  const tableRow = (y: number, key: 'ondemand' | 'partner' | 'total', index: number) => {
    const isChosen = String(chosenKey) === key;
    const copy = offerCopy(key);
    const room = planRoom(key);
    
    doc.save();
    
    // Row background
    if (isChosen) {
      doc.rect(left, y, W, rowH)
         .fillColor(C.primary + '08')
         .fill();
    } else if (index % 2 === 1) {
      doc.rect(left, y, W, rowH)
         .fillColor(C.grayLighter)
         .fill();
    }
    
    // Row border
    doc.rect(left, y, W, rowH)
       .lineWidth(0.5)
       .strokeColor(C.grayLight)
       .stroke();
    
    // Plan name with icon
    doc.fillColor(C.dark)
       .font('Helvetica')
       .fontSize(10)
       .text(`${copy.icon} ${copy.title}`, left + 16, y + 7, {
         width: 134
       });
    
    // Prices
    doc.font('Helvetica-Bold');
    doc.fillColor(isChosen ? C.primary : C.dark)
       .text(money0(room.carpet), left + 166, y + 7, {
         width: 110,
         align: 'right'
       });
    
    doc.fillColor(isChosen ? C.primary : C.dark)
       .text(money0(room.tile), left + 286, y + 7, {
         width: 110,
         align: 'right'
       });
    
    doc.fillColor(isChosen ? C.primary : C.dark)
       .fontSize(11)
       .text(money0(room.both), left + 406, y + 6, {
         width: W - 406 - 16,
         align: 'right'
       });
    
    doc.restore();
  };
  
  tableRow(rowStartY, 'ondemand', 0);
  tableRow(rowStartY + rowH, 'partner', 1);
  tableRow(rowStartY + rowH * 2, 'total', 2);
  
  // Table note
  doc.save();
  doc.fillColor(C.gray)
     .font('Helvetica')
     .fontSize(8)
     .text('* Corridor pricing available upon request. Common areas billed per square foot.', 
           left, rowStartY + rowH * 3 + 8, {
             width: W
           });
  doc.restore();

  // ---------- BENEFITS SECTION ----------
  const benefitsY = rowStartY + rowH * 3 + 32;
  
  drawSectionHeader('Why Choose Florida Eco Services', benefitsY);
  
  const benefitsContentY = benefitsY + 28;
  const benefitsH = 100;
  const benefitColW = (W - 20) / 2;
  
  // Left column - What's included
  drawGradientCard(left, benefitsContentY, benefitColW, benefitsH);
  
  doc.save();
  doc.fillColor(C.dark)
     .font('Helvetica-Bold')
     .fontSize(10)
     .text('PREMIUM SERVICE INCLUDES', left + 16, benefitsContentY + 16);
  
  const benefitsList = [
    { icon: '✓', text: 'Tile & grout deep cleaning' },
    { icon: '✓', text: 'Carpet encapsulation cleaning' },
    { icon: '✓', text: 'Odor neutralization' },
    { icon: '✓', text: 'Eco-friendly solutions' },
    { icon: '✓', text: 'Hotel-optimized scheduling' },
    { icon: '✓', text: '24/7 emergency support' }
  ];
  
  let benefitY = benefitsContentY + 40;
  benefitsList.forEach((benefit, i) => {
    if (i < 3) { // First column
      doc.fillColor(C.primary)
         .font('Helvetica-Bold')
         .fontSize(9)
         .text(benefit.icon, left + 16, benefitY);
      
      doc.fillColor(C.grayDark)
         .font('Helvetica')
         .fontSize(9)
         .text(benefit.text, left + 30, benefitY, {
           width: benefitColW - 46
         });
      
      benefitY += 16;
    }
  });
  
  doc.restore();
  
  // Right column - Process & Guarantee
  drawGradientCard(left + benefitColW + 20, benefitsContentY, benefitColW, benefitsH);
  
  doc.save();
  doc.fillColor(C.dark)
     .font('Helvetica-Bold')
     .fontSize(10)
     .text('OUR GUARANTEE', left + benefitColW + 36, benefitsContentY + 16);
  
  benefitY = benefitsContentY + 40;
  benefitsList.forEach((benefit, i) => {
    if (i >= 3) { // Second column
      doc.fillColor(C.primary)
         .font('Helvetica-Bold')
         .fontSize(9)
         .text(benefit.icon, left + benefitColW + 36, benefitY);
      
      doc.fillColor(C.grayDark)
         .font('Helvetica')
         .fontSize(9)
         .text(benefit.text, left + benefitColW + 50, benefitY, {
           width: benefitColW - 66
         });
      
      benefitY += 16;
    }
  });
  
  // CTA Box
  const ctaY = benefitsContentY + benefitsH - 36;
  doc.rect(left + benefitColW + 36, ctaY, benefitColW - 52, 28)
     .fillColor(C.primary + '20')
     .fill();
  
  doc.fillColor(C.primary)
     .font('Helvetica-Bold')
     .fontSize(9)
     .text('Ready to elevate your cleanliness?', left + benefitColW + 42, ctaY + 8, {
       width: benefitColW - 64
     });
  
  doc.fillColor(C.dark)
     .font('Helvetica-Bold')
     .fontSize(8)
     .text('APPROVE ONLINE TO LOCK YOUR RATE', left + benefitColW + 42, ctaY + 20, {
       width: benefitColW - 64
     });
  
  doc.restore();

  // ---------- FOOTER / SIGNATURE ----------
  const footerY = Math.min(benefitsContentY + benefitsH + 40, top + H - 100);
  const footerH = 80;
  
  drawGradientCard(left, footerY, W, footerH);
  
  // Footer content
  doc.save();
  
  if (opts.acceptance) {
    // Accepted version
    const a = opts.acceptance;
    doc.fillColor(C.success)
       .font('Helvetica-Bold')
       .fontSize(11)
       .text('✓ QUOTE ACCEPTED', left + 16, footerY + 16);
    
    const acceptedLines = [
      `Plan: ${offerCopy(chosenKey).title}`,
      `Signed by: ${a.signedByName}${a.signedByTitle ? ` (${a.signedByTitle})` : ''}`,
      `Date: ${a.acceptedAt.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}`
    ];
    
    doc.fillColor(C.grayDark)
       .font('Helvetica')
       .fontSize(9)
       .text(acceptedLines.join(' • '), left + 16, footerY + 36, {
         width: W - 32,
         lineGap: 4
       });
  } else {
    // Pending approval version
    doc.fillColor(C.dark)
       .font('Helvetica-Bold')
       .fontSize(11)
       .text('NEXT STEPS', left + 16, footerY + 16);
    
    doc.fillColor(C.grayDark)
       .font('Helvetica')
       .fontSize(9)
       .text('This quote is valid for 30 days. To proceed:', left + 16, footerY + 34, {
         width: W - 32
       });
    
    doc.fillColor(C.primary)
       .font('Helvetica-Bold')
       .fontSize(9)
       .text('1. Select your preferred plan • 2. Approve digitally online • 3. We\'ll contact you to schedule', 
             left + 16, footerY + 52, {
               width: W - 32
             });
  }
  
  // Company info
  doc.fillColor(C.gray)
     .font('Helvetica')
     .fontSize(8)
     .text(`${BRAND.name} • ${BRAND.address1} • ${BRAND.address2} • ${BRAND.phone} • ${BRAND.email} • ${BRAND.website}`, 
           left + 16, footerY + footerH - 20, {
             width: W - 32
           });
  
  doc.restore();

  // ---------- FINAL PAGE NUMBER ----------
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    
    // Add page number at bottom
    doc.fillColor(C.gray)
       .font('Helvetica')
       .fontSize(8)
       .text(`Page ${i + 1} of ${pageCount}`, 
             left, doc.page.height - 20, {
               width: W,
               align: 'center'
             });
  }

  doc.end();
  return done;
}
