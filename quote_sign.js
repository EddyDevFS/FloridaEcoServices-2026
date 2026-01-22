(() => {
  const apiBase = (window.FECO?.API_BASE || 'http://localhost:3001').toString().replace(/\/+$/, '');

  const qsMeta = document.getElementById('qsMeta');
  const scopeHost = document.getElementById('qsScope');
  const offersHost = document.getElementById('qsOffers');
  const downloadBtn = document.getElementById('qsDownloadBtn');
  const printBtn = document.getElementById('qsPrintBtn');
  const signBtn = document.getElementById('qsSignBtn');
  const statusEl = document.getElementById('qsStatus');
  const successEl = document.getElementById('qsSuccess');

  const nameEl = document.getElementById('qsName');
  const titleEl = document.getElementById('qsTitle');
  const emailEl = document.getElementById('qsEmail');

  const params = new URLSearchParams(window.location.search || '');
  const token = String(params.get('token') || '').trim();

  let quote = null;
  let selectedPlanKey = 'total';

  function setStatus(text, kind = 'info') {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.style.color = kind === 'error' ? '#b91c1c' : kind === 'success' ? '#065f46' : '#64748b';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function money(n) {
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  }

  function money2(n) {
    if (!Number.isFinite(n)) return '—';
    return `$${Number(n).toFixed(2)}`;
  }

  function currentFreqLabel(payload) {
    const state = payload && typeof payload === 'object' ? payload : {};
    const key = String(state.currentFrequency || '').trim();
    const map = {
      '1/year': 'Once per year',
      '2/year': 'Twice per year',
      '3/year': 'Three times per year',
      quarterly: 'Quarterly',
      monthly: 'Monthly',
      unknown: 'Not sure'
    };
    return map[key] || '—';
  }

  function clampInt(v, min, max) {
    let n = parseInt(String(v ?? ''), 10);
    if (Number.isNaN(n)) n = min;
    return Math.max(min, Math.min(max, n));
  }

  function computeRoomsFinal(payload) {
    const state = payload && typeof payload === 'object' ? payload : {};
    const buildingsCount = clampInt(state.buildingsCount, 1, 25);
    const buildings = Array.isArray(state.buildings) ? state.buildings.slice(0, buildingsCount) : [];
    while (buildings.length < buildingsCount) buildings.push({ floors: 0, roomsPerFloor: 0 });
    let roomsCalculated = 0;
    for (const b of buildings) roomsCalculated += clampInt(b?.floors, 0, 99) * clampInt(b?.roomsPerFloor, 0, 200);
    const roomsOverride = state.roomsOverride;
    const roomsFinal =
      roomsOverride !== null &&
      roomsOverride !== undefined &&
      roomsOverride !== '' &&
      !Number.isNaN(parseInt(String(roomsOverride), 10))
        ? clampInt(roomsOverride, 0, 99999)
        : roomsCalculated;
    return roomsFinal;
  }

  function computeCorridorSqft(payload) {
    const state = payload && typeof payload === 'object' ? payload : {};
    const corridor = state.corridor || {};
    const enabled = !!corridor.enabled;
    if (!enabled) return 0;
    const qty = clampInt(corridor.qty, 0, 9999);
    const sqftPer = clampInt(corridor.sqftPer, 0, 999999);
    const calculated = qty * sqftPer;
    const override = corridor.sqftOverride;
    const finalSqft =
      override !== null && override !== undefined && override !== '' && !Number.isNaN(parseInt(String(override), 10))
        ? clampInt(override, 0, 999999999)
        : calculated;
    return finalSqft;
  }

  function getPlan(payload, planKey) {
    const state = payload && typeof payload === 'object' ? payload : {};
    const plan = state?.pricing?.plans?.[planKey] || {};
    const room = plan.room || {};
    const carpetSqft = Number(plan.carpetSqft ?? plan.carpetSqftPrice ?? plan.corridorSqft) || 0;
    const tileSqft = Number(plan.tileSqft ?? plan.tileSqftPrice ?? plan.corridorSqft) || 0;
    return {
      room: {
        carpet: Number(room.carpet) || 0,
        tile: Number(room.tile) || 0,
        both: Number(room.both) || 0
      },
      carpetSqft,
      tileSqft
    };
  }

  function offersCopy(planKey) {
    if (planKey === 'ondemand') {
      return {
        title: 'On‑Demand',
        tagline: 'Perfect for one-time projects or urgent needs.',
        bullets: ['One-time service (as needed)', 'Ideal for emergencies / turnovers', 'Great on carpet, tile, and area rugs']
      };
    }
    if (planKey === 'partner') {
      return {
        title: 'Refresh Plan',
        tagline: 'Best value for partial yearly coverage + planning.',
        bullets: ['Great if you target ~50% of rooms yearly', 'Better per-room rate than on-demand', 'Planned maintenance with priority']
      };
    }
    return {
      title: 'Total Care',
      tagline: 'Full annual coverage + the best per-room value.',
      bullets: ['All rooms 1×/year', 'Ongoing visits scheduled with you', 'Best per-room rate + priority']
    };
  }

  function renderScope() {
    if (!scopeHost) return;
    const payload = quote?.payload || {};
    const rooms = computeRoomsFinal(payload);
    const sqft = computeCorridorSqft(payload);
    const freq = currentFreqLabel(payload);
    const hotelAddress = String(payload?.hotel?.address || quote?.title || '').trim();

    scopeHost.style.display = '';
    scopeHost.innerHTML = `
      <div class="qs-scopeCard">
        <div class="k">Rooms</div>
        <div class="v">${escapeHtml(new Intl.NumberFormat('en-US').format(Math.round(rooms || 0)))}</div>
      </div>
      <div class="qs-scopeCard">
        <div class="k">Corridor sqft</div>
        <div class="v">${escapeHtml(new Intl.NumberFormat('en-US').format(Math.round(sqft || 0)))}</div>
      </div>
      <div class="qs-scopeCard">
        <div class="k">Current cleaning frequency</div>
        <div class="v small">${escapeHtml(freq)}</div>
      </div>
      ${hotelAddress ? `<div class="qs-scopeCard" style="grid-column:1/-1;"><div class="k">Location</div><div class="v small">${escapeHtml(hotelAddress)}</div></div>` : ''}
    `;
  }

  function renderOffers() {
    if (!offersHost) return;
    const payload = quote?.payload || {};
    const keys = ['ondemand', 'partner', 'total'];
    offersHost.innerHTML = keys
      .map((k) => {
        const copy = offersCopy(k);
        const plan = getPlan(payload, k);
        const price = money(plan.room.both);
        const active = k === selectedPlanKey ? 'active' : '';
        return `
          <div class="qs-offer ${active}" data-plan="${escapeHtml(k)}">
            <h3>${escapeHtml(copy.title)}</h3>
            <div class="tagline">${escapeHtml(copy.tagline)}</div>
            <div class="qs-price">
              <b>${escapeHtml(price)}</b>
              <span>Both surfaces / room</span>
            </div>
            <div class="qs-mini">
              <div class="row"><small>Carpet / room</small><span>${escapeHtml(money(plan.room.carpet))}</span></div>
              <div class="row"><small>Tile / room</small><span>${escapeHtml(money(plan.room.tile))}</span></div>
              <div class="row"><small>Carpet $/sqft (common areas)</small><span>${escapeHtml(money2(plan.carpetSqft))}</span></div>
              <div class="row"><small>Tile $/sqft (common areas)</small><span>${escapeHtml(money2(plan.tileSqft))}</span></div>
            </div>
            <div class="qs-bullets">
              ${copy.bullets
                .map((b) => `<div><i class="fa-solid fa-check"></i><span>${escapeHtml(b)}</span></div>`)
                .join('')}
            </div>
          </div>
        `;
      })
      .join('');

    offersHost.querySelectorAll('[data-plan]').forEach((el) => {
      el.addEventListener('click', () => {
        selectedPlanKey = String(el.getAttribute('data-plan') || 'total');
        renderOffers();
      });
    });
  }

  async function loadQuote() {
    if (!token) throw new Error('Missing token.');
    const res = await fetch(`${apiBase}/api/v1/public/quotes/by-token/${encodeURIComponent(token)}`, { credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || 'quote_not_found');
    quote = body.quote;

    const company = String(quote?.title || '').trim();
    const number = quote?.number ? `#${quote.number}` : '';
    if (qsMeta) qsMeta.textContent = [number, company].filter(Boolean).join(' · ') || 'Quote';

    if (quote?.status === 'ACCEPTED') {
      selectedPlanKey = String(quote?.acceptedPlanKey || 'total') || 'total';
      if (successEl) {
        successEl.style.display = '';
        successEl.textContent = 'This quote is already accepted. You can download the PDF copy.';
      }
      if (signBtn) signBtn.disabled = true;
    }

    renderScope();
    renderOffers();
    setStatus('', 'info');
  }

  async function accept() {
    if (!token) return;
    const signedByName = String(nameEl?.value || '').trim();
    const signedByTitle = String(titleEl?.value || '').trim();
    const signedByEmail = String(emailEl?.value || '').trim();
    if (!signedByName || !signedByTitle || !signedByEmail) {
      return setStatus('Name, title, and email are required.', 'error');
    }
    setStatus('Submitting…', 'info');
    signBtn.disabled = true;
    try {
      const res = await fetch(`${apiBase}/api/v1/public/quotes/by-token/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ acceptedPlanKey: selectedPlanKey, signedByName, signedByTitle, signedByEmail })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'accept_failed');
      setStatus('Signed. Confirmation email sent.', 'success');
      if (successEl) {
        successEl.style.display = '';
        successEl.textContent =
          'Signed successfully. A confirmation email with a PDF copy has been sent. Eddy Sallault will contact you shortly to confirm dates and organization details.';
      }
      setTimeout(() => {
        try {
          window.location.href = 'index.html';
        } catch {}
      }, 2200);
    } catch (e) {
      signBtn.disabled = false;
      setStatus(String(e?.message || e), 'error');
      return;
    }
  }

  downloadBtn?.addEventListener('click', () => {
    if (!token) return;
    window.open(`${apiBase}/api/v1/public/quotes/by-token/${encodeURIComponent(token)}/pdf`, '_blank');
  });
  printBtn?.addEventListener('click', () => window.print());
  signBtn?.addEventListener('click', () => accept());

  loadQuote().catch((e) => setStatus(String(e?.message || e), 'error'));
})();
