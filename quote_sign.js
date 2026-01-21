(() => {
  const apiBase = (window.FECO?.API_BASE || 'http://localhost:3001').toString().replace(/\/+$/, '');

  const qsMeta = document.getElementById('qsMeta');
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

  function computeAvgPerRoom(payload, planKey) {
    const state = payload && typeof payload === 'object' ? payload : {};
    const plan = state?.pricing?.plans?.[planKey] || {};
    const room = plan.room || {};
    const minRooms = Number(state?.pricing?.minRooms || 0) || 0;

    const buildings = Array.isArray(state.buildings) ? state.buildings : [];
    const buildingsCount = Number(state.buildingsCount || buildings.length || 0) || buildings.length || 0;
    const used = buildings.slice(0, Math.max(0, buildingsCount));
    let roomsCalc = 0;
    for (const b of used) {
      const floors = parseInt(String(b?.floors ?? 0), 10) || 0;
      const roomsPerFloor = parseInt(String(b?.roomsPerFloor ?? 0), 10) || 0;
      roomsCalc += Math.max(0, floors) * Math.max(0, roomsPerFloor);
    }
    const ov = state.roomsOverride;
    const roomsFinal =
      ov !== null && ov !== undefined && ov !== '' && !Number.isNaN(parseInt(String(ov), 10)) ? parseInt(String(ov), 10) : roomsCalc;
    const billed = Math.max(roomsFinal, minRooms);
    if (!billed) return { perRoom: 0, billedRooms: 0 };

    const mode = String(state.mode || 'quick');
    let roomsCost = 0;
    if (mode === 'advanced' && state.roomMix) {
      const m = state.roomMix || {};
      const carpet = parseInt(String(m.carpet || 0), 10) || 0;
      const tile = parseInt(String(m.tile || 0), 10) || 0;
      const both = parseInt(String(m.both || 0), 10) || 0;
      roomsCost = carpet * (Number(room.carpet) || 0) + tile * (Number(room.tile) || 0) + both * (Number(room.both) || 0);
      if (billed > roomsFinal) roomsCost += (billed - roomsFinal) * (Number(room.both) || 0);
    } else {
      roomsCost = billed * (Number(room.both) || 0);
    }

    return { perRoom: roomsCost / billed, billedRooms: billed };
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

  function renderOffers() {
    if (!offersHost) return;
    const payload = quote?.payload || {};
    const keys = ['ondemand', 'partner', 'total'];
    offersHost.innerHTML = keys
      .map((k) => {
        const copy = offersCopy(k);
        const calc = computeAvgPerRoom(payload, k);
        const price = money(calc.perRoom);
        const active = k === selectedPlanKey ? 'active' : '';
        return `
          <div class="qs-offer ${active}" data-plan="${escapeHtml(k)}">
            <h3>${escapeHtml(copy.title)}</h3>
            <div class="tagline">${escapeHtml(copy.tagline)}</div>
            <div class="qs-price">
              <b>${escapeHtml(price)}</b>
              <span>avg price / room</span>
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
