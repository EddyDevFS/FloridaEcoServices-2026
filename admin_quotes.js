/* global fecoEnsureLogin, fecoRefreshMe, fecoApiBase */

(() => {
  const $ = (id) => document.getElementById(id);

  function toast(msg, type = 'info') {
    const host = $('toastContainer');
    if (!host) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = String(msg || '');
    host.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  function apiBase() {
    try {
      if (typeof fecoApiBase === 'function') return fecoApiBase();
    } catch {}
    const cfg = window.FECO || {};
    return (cfg.API_BASE || localStorage.getItem('feco.apiBase') || 'http://localhost:3001')
      .toString()
      .trim()
      .replace(/\/+$/, '');
  }

  async function apiFetch(path, init = {}) {
    const token = String(localStorage.getItem('feco.accessToken') || '').trim();
    const res = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      credentials: 'include'
    });

    if (res.status !== 401) return res;

    // Try refresh once (cookie-based refresh token).
    try {
      const refresh = await fetch(`${apiBase()}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include'
      });
      if (refresh.ok) {
        const body = await refresh.json().catch(() => ({}));
        if (body?.accessToken) localStorage.setItem('feco.accessToken', String(body.accessToken));
      }
    } catch {}

    const token2 = String(localStorage.getItem('feco.accessToken') || '').trim();
    return fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
        ...(token2 ? { Authorization: `Bearer ${token2}` } : {})
      },
      credentials: 'include'
    });
  }

  function money(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  }
  function num(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    return new Intl.NumberFormat('en-US').format(n);
  }
  function clampInt(v, min, max) {
    let n = parseInt(v, 10);
    if (Number.isNaN(n)) n = min;
    return Math.max(min, Math.min(max, n));
  }

  function freshState() {
    return {
      step: 0,
      mode: 'quick',
      hotel: { name: '', address: '', tel: '', contact: '', contactPhone: '', email: '', role: '' },
      buildingsCount: 1,
      buildings: [{ floors: 4, roomsPerFloor: 12 }],
      roomsCalculated: 0,
      roomsOverride: null,
      roomMix: { carpet: 0, tile: 0, both: 0 },
      corridor: { enabled: true, qty: 16, sqftPer: 2000, sqftCalculated: 0, sqftOverride: null },
      currentFrequency: '1/year',
      pricing: {
        minRooms: 10,
        plans: {
          ondemand: { label: 'On-Demand', subtitle: 'Best for emergencies & one-off deep cleans', room: { carpet: 45, tile: 65, both: 95 }, corridorSqft: 0.28 },
          partner: { label: 'Partner Care', subtitle: 'Better rates + priority scheduling', room: { carpet: 40, tile: 60, both: 85 }, corridorSqft: 0.25 },
          total: { label: 'Total Care Program', subtitle: 'Monthly plan · annual coverage + best cost', room: { carpet: 35, tile: 50, both: 70 }, corridorSqft: 0.18 }
        }
      }
    };
  }

  let quoteId = '';
  let quoteNumber = '';
  let quoteStatus = 'DRAFT';
  let customerType = 'PROSPECT';
  let customer = { company: '', contact: '', email: '', phone: '' };
  let state = freshState();

  const steps = [
    { title: 'Hotel Info' },
    { title: 'Structure' },
    { title: 'Surfaces' },
    { title: 'Recap' },
    { title: 'Current Frequency' },
    { title: 'Offers' },
    { title: 'Pricing Editor' },
    { title: 'Proposal Preview' }
  ];

  function ensureBuildings() {
    const c = state.buildingsCount;
    while (state.buildings.length < c) state.buildings.push({ floors: 4, roomsPerFloor: 12 });
    while (state.buildings.length > c) state.buildings.pop();
  }

  function calcRooms() {
    ensureBuildings();
    let total = 0;
    for (const b of state.buildings) total += clampInt(b.floors, 0, 99) * clampInt(b.roomsPerFloor, 0, 200);
    state.roomsCalculated = total;
    return total;
  }

  function roomsFinal() {
    const c = calcRooms();
    const ov = state.roomsOverride;
    return ov !== null && ov !== '' && !Number.isNaN(parseInt(ov, 10)) ? clampInt(ov, 0, 99999) : c;
  }

  function calcCorridorSqft() {
    if (!state.corridor.enabled) {
      state.corridor.sqftCalculated = 0;
      return 0;
    }
    const qty = clampInt(state.corridor.qty, 0, 9999);
    const sqftPer = clampInt(state.corridor.sqftPer, 0, 999999);
    const total = qty * sqftPer;
    state.corridor.sqftCalculated = total;
    return total;
  }

  function corridorFinalSqft() {
    const c = calcCorridorSqft();
    const ov = state.corridor.sqftOverride;
    if (!state.corridor.enabled) return 0;
    return ov !== null && ov !== '' && !Number.isNaN(parseInt(ov, 10)) ? clampInt(ov, 0, 999999999) : c;
  }

  function validateMix() {
    if (state.mode !== 'advanced') return true;
    const total = roomsFinal();
    const m = state.roomMix;
    const s = clampInt(m.carpet, 0, 999999) + clampInt(m.tile, 0, 999999) + clampInt(m.both, 0, 999999);
    return s === total;
  }

  function defaultMixIfNeeded() {
    if (state.mode !== 'advanced') return;
    const total = roomsFinal();
    const m = state.roomMix;
    const s = clampInt(m.carpet, 0, 999999) + clampInt(m.tile, 0, 999999) + clampInt(m.both, 0, 999999);
    if (s === 0 && total > 0) state.roomMix.both = total;
  }

  function roomCountForPricing(type) {
    if (state.mode === 'quick') return type === 'both' ? roomsFinal() : 0;
    defaultMixIfNeeded();
    return clampInt(state.roomMix[type], 0, 999999);
  }

  function computeAnnualForPlan(planKey) {
    const plan = state.pricing.plans[planKey];
    const rf = roomsFinal();
    if (rf <= 0) return { roomsAnnual: 0, corridorAnnual: 0, totalAnnual: 0, monthly: 0, avgPerRoom: 0 };

    const minRooms = state.pricing.minRooms;
    const billedRooms = Math.max(rf, minRooms);
    const carpet = roomCountForPricing('carpet');
    const tile = roomCountForPricing('tile');
    const both = roomCountForPricing('both');

    const mixOk = validateMix();
    let roomsCost = 0;

    if (state.mode === 'advanced' && mixOk) {
      roomsCost = carpet * plan.room.carpet + tile * plan.room.tile + both * plan.room.both;
      if (billedRooms > rf) roomsCost += (billedRooms - rf) * plan.room.both;
    } else {
      roomsCost = billedRooms * plan.room.both;
    }

    const corridorSqft = corridorFinalSqft();
    const corridorCost = corridorSqft * plan.corridorSqft;
    const totalAnnual = roomsCost + corridorCost;
    const monthly = totalAnnual / 12;
    const avgPerRoom = roomsCost / billedRooms;
    return { roomsAnnual: roomsCost, corridorAnnual: corridorCost, totalAnnual, monthly, avgPerRoom };
  }

  function currentFreqLabel() {
    const map = { '1/year': '1 time / year', '2/year': '2 times / year', '3/year': '3 times / year', quarterly: 'Quarterly', monthly: 'Monthly program', unknown: 'Not sure' };
    return map[state.currentFrequency] || '—';
  }

  function setStatus(text, kind = 'ok') {
    const el = $('summaryStatus');
    if (!el) return;
    el.textContent = text;
    el.className = `tag ${kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : ''}`.trim();
  }

  function renderSteps() {
    const host = $('steps');
    if (!host) return;
    host.innerHTML = steps
      .map((s, i) => {
        const active = i === state.step ? 'active' : '';
        return `<div class="step ${active}" data-step="${i}"><span class="n">${i + 1}</span><span>${s.title}</span></div>`;
      })
      .join('');
    host.querySelectorAll('[data-step]').forEach((el) => {
      el.addEventListener('click', () => {
        state.step = clampInt(el.getAttribute('data-step'), 0, steps.length - 1);
        render();
        scheduleSave();
      });
    });
  }

  function fieldRow(label, inputHtml) {
    return `
      <div class="qwRow">
        <label class="qwLabel">${label}</label>
        <div class="qwControl">${inputHtml}</div>
      </div>
    `;
  }

  function renderStepHotel() {
    return `
      <div class="qwCard">
        <h3>Hotel</h3>
        ${fieldRow('Hotel name', `<input class="qwInput" id="hotelName" placeholder="Hotel name" value="${escapeHtml(state.hotel.name || '')}">`)}
        ${fieldRow('Address (optional)', `<input class="qwInput" id="hotelAddress" placeholder="Address" value="${escapeHtml(state.hotel.address || '')}">`)}
        ${fieldRow('Main phone (optional)', `<input class="qwInput" id="hotelTel" placeholder="+1 ..." value="${escapeHtml(state.hotel.tel || '')}">`)}
      </div>
      <div class="qwCard">
        <h3>Contact (optional)</h3>
        ${fieldRow('Contact name', `<input class="qwInput" id="hotelContact" placeholder="Name" value="${escapeHtml(state.hotel.contact || '')}">`)}
        ${fieldRow('Role', `<input class="qwInput" id="hotelRole" placeholder="GM / Ops / etc." value="${escapeHtml(state.hotel.role || '')}">`)}
        ${fieldRow('Contact phone', `<input class="qwInput" id="hotelContactPhone" placeholder="+1 ..." value="${escapeHtml(state.hotel.contactPhone || '')}">`)}
        ${fieldRow('Email', `<input class="qwInput" id="hotelEmail" placeholder="email@hotel.com" value="${escapeHtml(state.hotel.email || '')}">`)}
      </div>
    `;
  }

  function renderStepStructure() {
    ensureBuildings();
    const rows = state.buildings
      .map(
        (b, idx) => `
        <div class="qwCard">
          <h3>Building ${idx + 1}</h3>
          ${fieldRow('Floors', `<input class="qwInput" type="number" min="0" max="99" data-bf="${idx}" data-k="floors" value="${clampInt(b.floors, 0, 99)}">`)}
          ${fieldRow('Rooms / floor', `<input class="qwInput" type="number" min="0" max="200" data-bf="${idx}" data-k="roomsPerFloor" value="${clampInt(b.roomsPerFloor, 0, 200)}">`)}
        </div>
      `
      )
      .join('');

    return `
      <div class="qwCard">
        <h3>Buildings</h3>
        ${fieldRow('Buildings count', `<input class="qwInput" id="buildingsCount" type="number" min="1" max="25" value="${clampInt(state.buildingsCount, 1, 25)}">`)}
        <div class="qwHint">Rooms are calculated from buildings × floors × rooms/floor.</div>
      </div>
      ${rows}
    `;
  }

  function renderStepSurfaces() {
    const rf = roomsFinal();
    return `
      <div class="qwCard">
        <h3>Mode</h3>
        <div class="qwHint">${state.mode === 'quick' ? 'Quick mode assumes "Both" for pricing.' : 'Advanced mode lets you set an exact mix.'}</div>
      </div>
      <div class="qwCard">
        <h3>Room mix</h3>
        <div class="qwHint">Rooms total: <b>${num(rf)}</b></div>
        ${fieldRow('Carpet rooms', `<input class="qwInput" id="mixCarpet" type="number" min="0" value="${clampInt(state.roomMix.carpet, 0, 999999)}" ${state.mode !== 'advanced' ? 'disabled' : ''}>`)}
        ${fieldRow('Tile rooms', `<input class="qwInput" id="mixTile" type="number" min="0" value="${clampInt(state.roomMix.tile, 0, 999999)}" ${state.mode !== 'advanced' ? 'disabled' : ''}>`)}
        ${fieldRow('Both rooms', `<input class="qwInput" id="mixBoth" type="number" min="0" value="${clampInt(state.roomMix.both, 0, 999999)}" ${state.mode !== 'advanced' ? 'disabled' : ''}>`)}
        <div class="qwHint">${state.mode !== 'advanced' ? 'Switch to Advanced to edit mix.' : validateMix() ? 'Mix is valid.' : 'Mix must match room total.'}</div>
      </div>
      <div class="qwCard">
        <h3>Corridors</h3>
        ${fieldRow('Enabled', `<select class="qwInput" id="corrEnabled"><option value="1" ${state.corridor.enabled ? 'selected' : ''}>Yes</option><option value="0" ${!state.corridor.enabled ? 'selected' : ''}>No</option></select>`)}
        ${fieldRow('How many corridors', `<input class="qwInput" id="corrQty" type="number" min="0" value="${clampInt(state.corridor.qty, 0, 9999)}" ${!state.corridor.enabled ? 'disabled' : ''}>`)}
        ${fieldRow('Sqft per corridor', `<input class="qwInput" id="corrSqftPer" type="number" min="0" value="${clampInt(state.corridor.sqftPer, 0, 999999)}" ${!state.corridor.enabled ? 'disabled' : ''}>`)}
      </div>
    `;
  }

  function renderStepRecap() {
    return `
      <div class="qwCard">
        <h3>Override totals</h3>
        <div class="qwHint">Calculated rooms: <b>${num(state.roomsCalculated)}</b></div>
        ${fieldRow('Rooms override (optional)', `<input class="qwInput" id="roomsOverride" type="number" min="0" value="${state.roomsOverride ?? ''}" placeholder="Leave blank">`)}
        <div class="qwHint">Calculated corridor sqft: <b>${num(state.corridor.sqftCalculated)}</b></div>
        ${fieldRow('Corridor sqft override (optional)', `<input class="qwInput" id="sqftOverride" type="number" min="0" value="${state.corridor.sqftOverride ?? ''}" placeholder="Leave blank" ${!state.corridor.enabled ? 'disabled' : ''}>`)}
      </div>
    `;
  }

  function renderStepFrequency() {
    const opts = [
      ['1/year', '1 time / year'],
      ['2/year', '2 times / year'],
      ['3/year', '3 times / year'],
      ['quarterly', 'Quarterly'],
      ['monthly', 'Monthly program'],
      ['unknown', 'Not sure']
    ];
    return `
      <div class="qwCard">
        <h3>Current frequency</h3>
        ${fieldRow(
          'Where are they today?',
          `<select class="qwInput" id="currentFreq">${opts
            .map(([v, label]) => `<option value="${v}" ${state.currentFrequency === v ? 'selected' : ''}>${label}</option>`)
            .join('')}</select>`
        )}
      </div>
    `;
  }

  function renderStepOffers() {
    const on = computeAnnualForPlan('ondemand');
    const pa = computeAnnualForPlan('partner');
    const to = computeAnnualForPlan('total');
    return `
      <div class="qwCard">
        <h3>Offers</h3>
        <div class="qwOfferGrid">
          ${renderOfferCard('On-Demand', on)}
          ${renderOfferCard('Partner Care', pa)}
          ${renderOfferCard('Total Care Program', to, true)}
        </div>
      </div>
    `;
  }

  function renderOfferCard(title, calc, highlight = false) {
    return `
      <div class="qwOffer ${highlight ? 'highlight' : ''}">
        <div class="qwOfferTitle">${title}</div>
        <div class="qwOfferRow"><span>Monthly est.</span><b>${money(calc.monthly)}</b></div>
        <div class="qwOfferRow"><span>Annual total</span><b>${money(Math.round(calc.totalAnnual))}</b></div>
      </div>
    `;
  }

  function renderStepPricing() {
    const p = state.pricing.plans;
    return `
      <div class="qwCard">
        <h3>Pricing</h3>
        ${fieldRow('Minimum rooms billed', `<input class="qwInput" id="minRooms" type="number" min="0" value="${clampInt(state.pricing.minRooms, 0, 99999)}">`)}
      </div>
      <div class="qwCard">
        <h3>On-Demand</h3>
        ${pricingFields('ondemand', p.ondemand)}
      </div>
      <div class="qwCard">
        <h3>Partner Care</h3>
        ${pricingFields('partner', p.partner)}
      </div>
      <div class="qwCard">
        <h3>Total Care Program</h3>
        ${pricingFields('total', p.total)}
      </div>
    `;
  }

  function pricingFields(key, plan) {
    return `
      ${fieldRow('Room (Carpet)', `<input class="qwInput" data-plan="${key}" data-p="room.carpet" type="number" min="0" value="${Number(plan.room.carpet) || 0}">`)}
      ${fieldRow('Room (Tile)', `<input class="qwInput" data-plan="${key}" data-p="room.tile" type="number" min="0" value="${Number(plan.room.tile) || 0}">`)}
      ${fieldRow('Room (Both)', `<input class="qwInput" data-plan="${key}" data-p="room.both" type="number" min="0" value="${Number(plan.room.both) || 0}">`)}
      ${fieldRow('Corridor $/sqft', `<input class="qwInput" data-plan="${key}" data-p="corridorSqft" type="number" min="0" step="0.01" value="${Number(plan.corridorSqft) || 0}">`)}
    `;
  }

  function renderStepPreview() {
    const best = computeAnnualForPlan('total');
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
    const hotelName = escapeHtml(state.hotel.name?.trim() || customer.company?.trim() || 'Proposal');
    return `
      <div class="qwCard">
        <h3>Proposal Preview</h3>
        <div class="proposal">
          <div class="proposalHeader">
            <div class="left">
              <b>Florida Eco Services</b>
              <div>Carpet, Upholstery &amp; Tile Cleaning<br>Orlando, FL</div>
            </div>
            <div class="right">
              <div class="tag brand">Quote · ${escapeHtml(dateStr)}</div>
              <div class="muted" style="margin-top:6px;">${hotelName}</div>
            </div>
          </div>
          <div class="proposalGrid">
            <div class="proposalCard">
              <div class="hd"><b>Scope</b></div>
              <div class="line"><span>Rooms</span><b>${num(roomsFinal())}</b></div>
              <div class="line"><span>Corridor sqft</span><b>${num(corridorFinalSqft())}</b></div>
              <div class="line"><span>Current frequency</span><b>${escapeHtml(currentFreqLabel())}</b></div>
            </div>
            <div class="proposalCard" style="border-color:rgba(31,157,85,.24);">
              <div class="hd"><b>Total Care Program</b><span class="miniTag" style="background:rgba(31,157,85,.10); border-color:rgba(31,157,85,.22); color:rgba(31,157,85,.92);">Best value</span></div>
              <div class="line"><span>Estimated monthly</span><b>${money(best.monthly)}</b></div>
              <div class="line"><span>Estimated annual total</span><b>${money(Math.round(best.totalAnnual))}</b></div>
            </div>
          </div>
        </div>
        <div class="qwHint" style="margin-top:10px;">Use “Send” to email a PDF version.</div>
      </div>
    `;
  }

  function bindStepInputs() {
    // Hotel
    $('hotelName')?.addEventListener('input', (e) => (state.hotel.name = e.target.value));
    $('hotelAddress')?.addEventListener('input', (e) => (state.hotel.address = e.target.value));
    $('hotelTel')?.addEventListener('input', (e) => (state.hotel.tel = e.target.value));
    $('hotelContact')?.addEventListener('input', (e) => (state.hotel.contact = e.target.value));
    $('hotelRole')?.addEventListener('input', (e) => (state.hotel.role = e.target.value));
    $('hotelContactPhone')?.addEventListener('input', (e) => (state.hotel.contactPhone = e.target.value));
    $('hotelEmail')?.addEventListener('input', (e) => (state.hotel.email = e.target.value));

    // Structure
    $('buildingsCount')?.addEventListener('input', (e) => {
      state.buildingsCount = clampInt(e.target.value, 1, 25);
      ensureBuildings();
      render();
    });
    document.querySelectorAll('[data-bf]').forEach((el) => {
      el.addEventListener('input', (e) => {
        const idx = clampInt(e.target.getAttribute('data-bf'), 0, 99);
        const key = String(e.target.getAttribute('data-k') || '').trim();
        if (!state.buildings[idx]) return;
        state.buildings[idx][key] = clampInt(e.target.value, 0, key === 'floors' ? 99 : 200);
        updateSummary();
        scheduleSave();
      });
    });

    // Surfaces
    $('mixCarpet')?.addEventListener('input', (e) => (state.roomMix.carpet = clampInt(e.target.value, 0, 999999)));
    $('mixTile')?.addEventListener('input', (e) => (state.roomMix.tile = clampInt(e.target.value, 0, 999999)));
    $('mixBoth')?.addEventListener('input', (e) => (state.roomMix.both = clampInt(e.target.value, 0, 999999)));
    $('corrEnabled')?.addEventListener('change', (e) => {
      state.corridor.enabled = String(e.target.value) === '1';
      render();
    });
    $('corrQty')?.addEventListener('input', (e) => (state.corridor.qty = clampInt(e.target.value, 0, 9999)));
    $('corrSqftPer')?.addEventListener('input', (e) => (state.corridor.sqftPer = clampInt(e.target.value, 0, 999999)));

    // Recap
    $('roomsOverride')?.addEventListener('input', (e) => (state.roomsOverride = e.target.value === '' ? null : clampInt(e.target.value, 0, 99999)));
    $('sqftOverride')?.addEventListener('input', (e) => (state.corridor.sqftOverride = e.target.value === '' ? null : clampInt(e.target.value, 0, 999999999)));

    // Frequency
    $('currentFreq')?.addEventListener('change', (e) => (state.currentFrequency = String(e.target.value || 'unknown')));

    // Pricing
    $('minRooms')?.addEventListener('input', (e) => (state.pricing.minRooms = clampInt(e.target.value, 0, 99999)));
    document.querySelectorAll('[data-plan]').forEach((el) => {
      el.addEventListener('input', (e) => {
        const planKey = String(e.target.getAttribute('data-plan') || '');
        const path = String(e.target.getAttribute('data-p') || '');
        const n = Number(e.target.value);
        if (!state.pricing.plans[planKey]) return;
        setDeep(state.pricing.plans[planKey], path, Number.isFinite(n) ? n : 0);
        updateSummary();
      });
    });

    // Common: auto-save on any input change.
    document.querySelectorAll('.qwInput').forEach((el) => {
      el.addEventListener('input', () => scheduleSave());
      el.addEventListener('change', () => scheduleSave());
    });
  }

  function setDeep(obj, path, value) {
    const parts = String(path || '').split('.').filter(Boolean);
    if (!parts.length) return;
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function updateSummary() {
    const rf = roomsFinal();
    const sqft = corridorFinalSqft();
    const best = computeAnnualForPlan('total');

    $('sumHotelName').textContent = (state.hotel.name || customer.company || '—').trim() || '—';
    const metaParts = [];
    if (state.hotel.address) metaParts.push(state.hotel.address.trim());
    if (customer.contact) metaParts.push(customer.contact.trim());
    $('sumHotelMeta').textContent = metaParts.length ? metaParts.join(' · ') : 'Fill the wizard to build a proposal.';
    $('sumFreq').textContent = `Current: ${currentFreqLabel()}`;
    $('sumRooms').textContent = num(rf);
    $('sumSqft').textContent = num(sqft);
    $('sumMonthly').textContent = money(best.monthly);

    const ok = validateMix();
    if (!ok) setStatus('Fix mix', 'warn');
    else setStatus('Ready', 'ok');
  }

  function render() {
    renderSteps();
    $('modeTag').textContent = `Mode: ${state.mode === 'quick' ? 'Quick' : 'Advanced'}`;
    $('btnToggleMode').textContent = state.mode === 'quick' ? 'Switch to Advanced' : 'Switch to Quick';

    const host = $('stepContainer');
    if (!host) return;

    if (state.step === 0) host.innerHTML = wrapCards(renderStepHotel());
    else if (state.step === 1) host.innerHTML = wrapCards(renderStepStructure());
    else if (state.step === 2) host.innerHTML = wrapCards(renderStepSurfaces());
    else if (state.step === 3) host.innerHTML = wrapCards(renderStepRecap());
    else if (state.step === 4) host.innerHTML = wrapCards(renderStepFrequency());
    else if (state.step === 5) host.innerHTML = wrapCards(renderStepOffers());
    else if (state.step === 6) host.innerHTML = wrapCards(renderStepPricing());
    else host.innerHTML = wrapCards(renderStepPreview());

    bindStepInputs();
    updateSummary();
    updateTopMeta();
  }

  function wrapCards(inner) {
    return `<div class="qwGrid">${inner}</div>`;
  }

  function updateTopMeta() {
    const meta = $('quoteMeta');
    if (meta) meta.textContent = quoteId ? `#${quoteNumber || '—'} · ${quoteStatus}` : '—';
  }

  let saveTimer = null;
  function scheduleSave() {
    if (!quoteId) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNow().catch(() => {}), 450);
  }

  async function saveNow() {
    if (!quoteId) return;
    setStatus('Saving…', 'warn');

    const body = {
      customerType,
      customer,
      payload: state,
      title: (state.hotel.name || customer.company || '').trim()
    };
    const res = await apiFetch(`/api/v1/quotes/${encodeURIComponent(quoteId)}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!res.ok) {
      setStatus('Save failed', 'warn');
      throw new Error('save_failed');
    }
    const data = await res.json().catch(() => ({}));
    quoteStatus = data?.quote?.status || quoteStatus;
    quoteNumber = data?.quote?.number || quoteNumber;
    setStatus('Saved', 'ok');
    updateTopMeta();
    await refreshQuoteList({ keepSelection: true });
  }

  async function refreshQuoteList({ keepSelection } = { keepSelection: true }) {
    const select = $('quoteSelect');
    if (!select) return;
    const prev = keepSelection ? select.value : '';
    const res = await apiFetch('/api/v1/quotes?limit=30', { method: 'GET' });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
    select.innerHTML = quotes
      .map((q) => {
        const label = `#${q.number || '—'} · ${q.title || 'Untitled'} · ${q.status}`;
        return `<option value="${escapeHtml(q.id)}">${escapeHtml(label)}</option>`;
      })
      .join('');
    if (prev && quotes.some((q) => q.id === prev)) select.value = prev;
    else if (quoteId && quotes.some((q) => q.id === quoteId)) select.value = quoteId;
  }

  async function loadQuote(id) {
    const res = await apiFetch(`/api/v1/quotes/${encodeURIComponent(id)}`, { method: 'GET' });
    if (!res.ok) throw new Error('quote_not_found');
    const data = await res.json().catch(() => ({}));
    const q = data?.quote;
    quoteId = q?.id || id;
    quoteNumber = q?.number || '';
    quoteStatus = q?.status || 'DRAFT';
    customerType = q?.customerType || 'PROSPECT';
    customer = q?.customer || { company: '', contact: '', email: '', phone: '' };
    state = q?.payload && typeof q.payload === 'object' ? q.payload : freshState();
    state.step = clampInt(state.step, 0, steps.length - 1);
    syncCustomerUiFromState();
    render();
    updateUrl();
  }

  async function createNewQuote() {
    const res = await apiFetch('/api/v1/quotes', { method: 'POST', body: JSON.stringify({ customerType, customer, payload: state }) });
    if (!res.ok) throw new Error('create_failed');
    const data = await res.json().catch(() => ({}));
    const q = data?.quote;
    quoteId = q?.id || '';
    quoteNumber = q?.number || '';
    quoteStatus = q?.status || 'DRAFT';
    updateTopMeta();
    await refreshQuoteList({ keepSelection: false });
    const select = $('quoteSelect');
    if (select && quoteId) select.value = quoteId;
    updateUrl();
  }

  function updateUrl() {
    try {
      const url = new URL(window.location.href);
      if (quoteId) url.searchParams.set('quoteId', quoteId);
      else url.searchParams.delete('quoteId');
      window.history.replaceState({}, '', url.toString());
    } catch {}
  }

  function syncCustomerUiFromState() {
    $('custCompany').value = customer.company || '';
    $('custContact').value = customer.contact || '';
    $('custEmail').value = customer.email || '';
    $('custPhone').value = customer.phone || '';
    $('customerType').value = customerType;
    updateCustomerTypeUi();
  }

  function updateCustomerTypeUi() {
    const isClient = customerType === 'CLIENT';
    $('clientPickerRow').style.display = isClient ? '' : 'none';
    $('btnConvertProspect').style.display = customerType === 'PROSPECT' ? '' : 'none';
  }

  async function refreshClients() {
    const res = await apiFetch('/api/v1/clients?limit=200', { method: 'GET' });
    const select = $('clientSelect');
    if (!select) return;
    if (!res.ok) {
      select.innerHTML = '';
      return;
    }
    const data = await res.json().catch(() => ({}));
    const clients = Array.isArray(data?.clients) ? data.clients : [];
    select.innerHTML = `<option value="">Select…</option>` + clients.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(`${c.company || c.name || 'Client'} (${c.email || 'no email'})`)}</option>`).join('');
  }

  async function createClientFromCustomer() {
    if (!customer.company && !customer.contact && !customer.email && !customer.phone) {
      toast('Fill customer details first.', 'error');
      return;
    }
    const res = await apiFetch('/api/v1/clients', { method: 'POST', body: JSON.stringify({ ...customer }) });
    if (!res.ok) throw new Error('client_create_failed');
    const data = await res.json().catch(() => ({}));
    const clientId = data?.client?.id;
    customerType = 'CLIENT';
    $('customerType').value = 'CLIENT';
    updateCustomerTypeUi();
    await refreshClients();
    $('clientSelect').value = clientId || '';
    if (quoteId && clientId) await apiFetch(`/api/v1/quotes/${encodeURIComponent(quoteId)}/link-client`, { method: 'POST', body: JSON.stringify({ clientId }) });
    await saveNow();
    toast('Client created and linked.', 'success');
  }

  async function convertProspectToClient() {
    if (customerType !== 'PROSPECT') return;
    await createClientFromCustomer();
  }

  async function linkSelectedClient() {
    const clientId = String($('clientSelect').value || '').trim();
    if (!clientId || !quoteId) return;
    const res = await apiFetch(`/api/v1/quotes/${encodeURIComponent(quoteId)}/link-client`, { method: 'POST', body: JSON.stringify({ clientId }) });
    if (!res.ok) throw new Error('link_failed');
    await saveNow();
    toast('Linked to client.', 'success');
  }

  async function downloadPdf() {
    if (!quoteId) return;
    const res = await apiFetch(`/api/v1/quotes/${encodeURIComponent(quoteId)}/pdf`, { method: 'GET', headers: { Accept: 'application/pdf' } });
    if (!res.ok) throw new Error('pdf_failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quote-${quoteNumber || quoteId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function sendEmail() {
    if (!quoteId) return;
    const to = (prompt('Send quote to (comma-separated emails):', customer.email || '') || '').trim();
    if (!to) return;
    const cc = (prompt('CC (optional, comma-separated emails):', '') || '').trim();
    const res = await apiFetch(`/api/v1/quotes/${encodeURIComponent(quoteId)}/send`, {
      method: 'POST',
      body: JSON.stringify({ to, cc })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'send_failed');
    }
    const data = await res.json().catch(() => ({}));
    quoteStatus = data?.quote?.status || quoteStatus;
    updateTopMeta();
    toast('Email sent.', 'success');
  }

  async function ensureLogin() {
    const token = String(localStorage.getItem('feco.accessToken') || '').trim();
    if (token) return true;
    try {
      if (typeof fecoEnsureLogin === 'function') fecoEnsureLogin();
    } catch {}
    toast('Login required (top-right badge).', 'error');
    return false;
  }

  function bindCustomerInputs() {
    const upd = () => {
      customer = {
        company: String($('custCompany').value || ''),
        contact: String($('custContact').value || ''),
        email: String($('custEmail').value || ''),
        phone: String($('custPhone').value || '')
      };
      updateSummary();
      scheduleSave();
    };
    ['custCompany', 'custContact', 'custEmail', 'custPhone'].forEach((id) => $(id)?.addEventListener('input', upd));

    $('customerType')?.addEventListener('change', async (e) => {
      customerType = String(e.target.value || 'PROSPECT');
      updateCustomerTypeUi();
      if (customerType === 'CLIENT') await refreshClients();
      scheduleSave();
    });

    $('clientSelect')?.addEventListener('change', () => linkSelectedClient().catch((e) => toast(e.message || 'Link failed', 'error')));
    $('btnCreateClient')?.addEventListener('click', () => createClientFromCustomer().catch((e) => toast(e.message || 'Client create failed', 'error')));
    $('btnConvertProspect')?.addEventListener('click', () => convertProspectToClient().catch((e) => toast(e.message || 'Convert failed', 'error')));
  }

  function bindTopbar() {
    $('btnNewQuote')?.addEventListener('click', () => {
      state = freshState();
      customerType = 'PROSPECT';
      customer = { company: '', contact: '', email: '', phone: '' };
      syncCustomerUiFromState();
      createNewQuote().then(() => render()).catch((e) => toast(e.message || 'Create failed', 'error'));
    });

    $('btnReset')?.addEventListener('click', () => {
      if (!confirm('Reset this quote wizard state?')) return;
      state = freshState();
      render();
      scheduleSave();
    });

    $('btnDownloadPdf')?.addEventListener('click', () => downloadPdf().catch((e) => toast(e.message || 'PDF failed', 'error')));
    $('btnSendEmail')?.addEventListener('click', () => sendEmail().catch((e) => toast(e.message || 'Send failed', 'error')));

    $('quoteSelect')?.addEventListener('change', (e) => {
      const id = String(e.target.value || '').trim();
      if (!id) return;
      loadQuote(id).catch((err) => toast(err.message || 'Load failed', 'error'));
    });
  }

  function bindNav() {
    $('btnBack')?.addEventListener('click', () => {
      state.step = Math.max(0, state.step - 1);
      render();
      scheduleSave();
    });
    $('btnNext')?.addEventListener('click', () => {
      state.step = Math.min(steps.length - 1, state.step + 1);
      render();
      scheduleSave();
    });
    $('btnToggleMode')?.addEventListener('click', () => {
      state.mode = state.mode === 'quick' ? 'advanced' : 'quick';
      render();
      scheduleSave();
    });
  }

  async function init() {
    if (!(await ensureLogin())) return;
    try {
      if (typeof fecoRefreshMe === 'function') await fecoRefreshMe();
    } catch {}

    bindCustomerInputs();
    bindTopbar();
    bindNav();

    await refreshQuoteList({ keepSelection: true });

    const params = new URLSearchParams(window.location.search || '');
    const fromUrl = String(params.get('quoteId') || '').trim();
    if (fromUrl) {
      await loadQuote(fromUrl);
      await refreshClients();
      return;
    }

    const select = $('quoteSelect');
    const first = select?.value || '';
    if (first) {
      await loadQuote(first);
      await refreshClients();
      return;
    }

    await createNewQuote();
    await refreshClients();
    render();
  }

  // Minimal CSS for wizard-only markup
  const style = document.createElement('style');
  style.textContent = `
    .quoteApp .qwGrid{display:grid; grid-template-columns:1fr 1fr; gap:12px}
    @media (max-width: 820px){ .quoteApp .qwGrid{grid-template-columns:1fr} }
    .quoteApp .qwCard{border:1px solid rgba(8,20,26,.12); background: rgba(255,255,255,.86); border-radius:16px; padding:14px}
    .quoteApp .qwCard h3{margin:0 0 10px; font-size:14px; letter-spacing:.2px; color:rgba(8,20,26,.92)}
    .quoteApp .qwRow{display:grid; grid-template-columns: 160px 1fr; gap:10px; align-items:center; padding:6px 0}
    @media (max-width: 520px){ .quoteApp .qwRow{grid-template-columns:1fr} }
    .quoteApp .qwLabel{font-size:12px; font-weight:900; color:rgba(8,20,26,.65)}
    .quoteApp .qwHint{margin-top:8px; font-size:12px; color:rgba(8,20,26,.58); line-height:1.35}
    .quoteApp .qwOfferGrid{display:grid; grid-template-columns:repeat(3,1fr); gap:10px}
    @media (max-width: 820px){ .quoteApp .qwOfferGrid{grid-template-columns:1fr} }
    .quoteApp .qwOffer{border:1px solid rgba(8,20,26,.12); background: rgba(255,255,255,.92); border-radius:16px; padding:12px}
    .quoteApp .qwOffer.highlight{border-color: rgba(31,157,85,.25); box-shadow: 0 12px 26px rgba(31,157,85,.08)}
    .quoteApp .qwOfferTitle{font-weight:950; color:rgba(8,20,26,.92)}
    .quoteApp .qwOfferRow{margin-top:8px; display:flex; justify-content:space-between; gap:10px; color:rgba(8,20,26,.70); font-weight:800}
    .quoteApp .proposal{margin-top:10px; border:1px solid rgba(8,20,26,.12); border-radius:16px; background:#fff; padding:14px}
    .quoteApp .proposalHeader{display:flex; justify-content:space-between; gap:12px; padding-bottom:10px; border-bottom:1px solid rgba(8,20,26,.12)}
    .quoteApp .proposalHeader .left div{color:rgba(8,20,26,.60); font-size:12px; margin-top:4px; line-height:1.35}
    .quoteApp .proposalGrid{display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px}
    @media (max-width: 520px){ .quoteApp .proposalGrid{grid-template-columns:1fr} }
    .quoteApp .proposalCard{border:1px solid rgba(8,20,26,.12); border-radius:14px; padding:12px}
    .quoteApp .proposalCard .hd{display:flex; align-items:center; justify-content:space-between; gap:10px; padding-bottom:10px; border-bottom:1px solid rgba(8,20,26,.10)}
    .quoteApp .proposalCard .miniTag{font-size:11px; padding:5px 9px; border-radius:999px; border:1px solid rgba(8,20,26,.12); background:rgba(8,20,26,.03); color:rgba(8,20,26,.70); font-weight:850}
    .quoteApp .proposalCard .line{display:flex; justify-content:space-between; gap:10px; padding:9px 0; border-bottom:1px dashed rgba(8,20,26,.10); color:rgba(8,20,26,.68); font-weight:850}
    .quoteApp .proposalCard .line:last-child{border-bottom:none}
    .quoteApp .proposalCard .line b{color:rgba(8,20,26,.92)}
  `;
  document.head.appendChild(style);

  init().catch((e) => toast(e.message || 'Init failed', 'error'));
})();

