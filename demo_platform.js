(() => {
  const $ = (sel) => document.querySelector(sel);

  const steps = [
    {
      id: 'onboarding',
      kicker: 'Onboarding',
      title: 'We set up your hotel exactly as it is.',
      subtitle:
        'Buildings, floors, rooms, corridors, lobbies—everything structured once, so planning becomes effortless.',
      bullets: [
        'Fast setup (bulk rooms + shared areas)',
        'Carpet / Tile / Both per room',
        'Deep-clean frequency and history tracking'
      ],
      screenTitle: 'Setup • Hotel structure',
      screenPill: 'Ready in minutes',
      screenHtml: `
        <div class="mock-app">
          <div class="mock-side">
            <div class="navitem active"><i class="fa-solid fa-sitemap"></i> Setup</div>
            <div class="navitem"><i class="fa-solid fa-calendar-check"></i> Planning</div>
            <div class="navitem"><i class="fa-solid fa-list-check"></i> Tasks</div>
            <div class="navitem"><i class="fa-solid fa-chart-line"></i> Reports</div>
          </div>
          <div class="mock-main">
            <div class="mock-main-inner">
              <div class="grid2">
                <div class="card">
                  <h4>Hotel</h4>
                  <div class="badge-note"><i class="fa-solid fa-hotel"></i> Demo Hotel Orlando</div>
                  <p class="p" style="margin-top:10px;">Building A → Floors 1–5 → Rooms 101–530</p>
                </div>
                <div class="card">
                  <h4>Defaults</h4>
                  <div class="kpis">
                    <div class="kpi"><b>Carpet</b><span>Guest rooms</span></div>
                    <div class="kpi"><b>Tile</b><span>Bathrooms / lobby</span></div>
                  </div>
                </div>
              </div>
              <div class="card" style="margin-top:12px;">
                <h4>Quick setup preview</h4>
                <div class="p">Rooms 201–230 (Floor 2) • Corridor • Elevator lobby • Notes & photos ready</div>
              </div>
            </div>
          </div>
        </div>
      `
    },
    {
      id: 'plan-a',
      kicker: 'Planning',
      title: 'Plan a cleaning in seconds.',
      subtitle:
        'Select rooms, add notes, choose Carpet/Tile per room when needed. Perfect for managers on iPad.',
      bullets: [
        'One-tap room selection',
        'Per-room notes for special cases',
        'Automatic “due soon / overdue” visibility'
      ],
      screenTitle: 'Planning • Select rooms',
      screenPill: 'Step 1/2',
      screenHtml: `
        <div class="mock-app">
          <div class="mock-side">
            <div class="navitem"><i class="fa-solid fa-sitemap"></i> Setup</div>
            <div class="navitem active"><i class="fa-solid fa-calendar-check"></i> Planning</div>
            <div class="navitem"><i class="fa-solid fa-list-check"></i> Tasks</div>
            <div class="navitem"><i class="fa-solid fa-chart-line"></i> Reports</div>
          </div>
          <div class="mock-main">
            <div class="mock-main-inner">
              <div class="card">
                <h4>Pick rooms (Carpet / Tile / Both)</h4>
                <div class="rooms-grid" style="margin-top:10px;">
                  ${[201,202,203,204,205,206,207,208,209,210,211,212].map((n, i) => {
                    const cls = i % 7 === 0 ? 'room overdue' : i % 5 === 0 ? 'room soon' : 'room';
                    const selected = [201,203,204,209,210].includes(n) ? ' selected' : '';
                    return `<div class="${cls}${selected}"><strong>${n}</strong><small>${i%3===0?'Carpet':'Both'} • ${i%4===0?'Note':'OK'}</small></div>`;
                  }).join('')}
                </div>
              </div>
              <div class="cta-card">
                <div><b>Manager note</b><small>“Focus on stains near entry in 203. Use Carpet pre-spray in 209.”</small></div>
              </div>
            </div>
          </div>
        </div>
      `
    },
    {
      id: 'plan-b',
      kicker: 'Scheduling',
      title: 'Choose a date and validate. Your hotel receives a confirmation link.',
      subtitle:
        'Hotels can approve, propose a different time, or add a room. Everyone stays aligned — no back-and-forth.',
      bullets: [
        'Shareable confirmation link',
        'Hotel can approve or propose a change',
        'Keeps a clean audit trail'
      ],
      screenTitle: 'Planning • Schedule',
      screenPill: 'Step 2/2',
      screenHtml: `
        <div class="mock-app">
          <div class="mock-side">
            <div class="navitem"><i class="fa-solid fa-sitemap"></i> Setup</div>
            <div class="navitem active"><i class="fa-solid fa-calendar-check"></i> Planning</div>
            <div class="navitem"><i class="fa-solid fa-list-check"></i> Tasks</div>
            <div class="navitem"><i class="fa-solid fa-chart-line"></i> Reports</div>
          </div>
          <div class="mock-main">
            <div class="mock-main-inner">
              <div class="grid2">
                <div class="card">
                  <h4>Date</h4>
                  <div class="badge-note"><i class="fa-solid fa-calendar"></i> Tue • 10:30 AM</div>
                  <p class="p" style="margin-top:10px;">Estimated duration: <b>2h 45</b></p>
                </div>
                <div class="card">
                  <h4>Confirmation</h4>
                  <div class="badge-note"><i class="fa-solid fa-link"></i> /reservation_view?token=…</div>
                  <p class="p" style="margin-top:10px;">Hotel: <b>Approve</b> / Propose / Add rooms</p>
                </div>
              </div>
              <div class="card" style="margin-top:12px;">
                <h4>What the hotel sees</h4>
                <div class="p">“Approve” creates a locked appointment + keeps a history of changes.</div>
              </div>
            </div>
          </div>
        </div>
      `
    },
    {
      id: 'overview',
      kicker: 'Daily overview',
      title: 'One glance: what is due, what is done, what needs attention.',
      subtitle:
        'Color codes help managers decide instantly: overdue deep cleans, due soon, done today — no spreadsheets.',
      bullets: [
        'Overdue / Due soon / Done visual cues',
        'Hotel history per room (proof ready)',
        'Perfect for daily standup'
      ],
      screenTitle: 'Dashboard • Deep clean status',
      screenPill: 'Live overview',
      screenHtml: `
        <div class="mock-app">
          <div class="mock-side">
            <div class="navitem"><i class="fa-solid fa-sitemap"></i> Setup</div>
            <div class="navitem active"><i class="fa-solid fa-calendar-check"></i> Planning</div>
            <div class="navitem"><i class="fa-solid fa-list-check"></i> Tasks</div>
            <div class="navitem"><i class="fa-solid fa-chart-line"></i> Reports</div>
          </div>
          <div class="mock-main">
            <div class="mock-main-inner">
              <div class="grid2">
                <div class="card">
                  <h4>This week</h4>
                  <div class="kpis">
                    <div class="kpi"><b>18</b><span>Rooms planned</span></div>
                    <div class="kpi"><b>4</b><span>Overdue</span></div>
                  </div>
                </div>
                <div class="card">
                  <h4>Execution</h4>
                  <div class="kpis">
                    <div class="kpi"><b>92%</b><span>On time</span></div>
                    <div class="kpi"><b>1 tap</b><span>Proof log</span></div>
                  </div>
                </div>
              </div>
              <div class="card" style="margin-top:12px;">
                <h4>Floor 2 • Rooms</h4>
                <div class="rooms-grid" style="margin-top:10px;">
                  ${[
                    {n:201, c:'done'}, {n:202, c:'done'}, {n:203, c:'done'},
                    {n:204, c:'soon'}, {n:205, c:'soon'}, {n:206, c:'room'},
                    {n:207, c:'room'}, {n:208, c:'room'}, {n:209, c:'overdue'},
                    {n:210, c:'overdue'}, {n:211, c:'room'}, {n:212, c:'room'}
                  ].map(r => `<div class="room ${r.c}"><strong>${r.n}</strong><small>${r.c==='done'?'Done today':r.c==='overdue'?'Overdue':r.c==='soon'?'Due soon':'OK'}</small></div>`).join('')}
                </div>
              </div>
            </div>
          </div>
        </div>
      `
    },
    {
      id: 'tasks-a',
      kicker: 'Tasks',
      title: 'Create a task and assign it to staff — instantly.',
      subtitle:
        'From “stain removal” to “tile grout” or “upholstery spot clean”: every action is tracked and owned.',
      bullets: [
        'Assign in 1 click',
        'Staff sees a focused list',
        'Keeps accountability clean'
      ],
      screenTitle: 'Tasks • Create & assign',
      screenPill: 'Fast operations',
      screenHtml: `
        <div class="mock-app">
          <div class="mock-side">
            <div class="navitem"><i class="fa-solid fa-sitemap"></i> Setup</div>
            <div class="navitem"><i class="fa-solid fa-calendar-check"></i> Planning</div>
            <div class="navitem active"><i class="fa-solid fa-list-check"></i> Tasks</div>
            <div class="navitem"><i class="fa-solid fa-chart-line"></i> Reports</div>
          </div>
          <div class="mock-main">
            <div class="mock-main-inner">
              <div class="grid2">
                <div class="card">
                  <h4>New task</h4>
                  <div class="p"><b>Room 203</b> • Carpet spot clean</div>
                  <div class="badge-note" style="margin-top:10px;"><i class="fa-solid fa-pen"></i> “Red wine stain near entrance.”</div>
                </div>
                <div class="card">
                  <h4>Assign to</h4>
                  <div class="p">Maria Lopez • James Taylor • Anna Nguyen</div>
                  <div class="badge-note" style="margin-top:10px;"><i class="fa-solid fa-user-check"></i> Assigned: Maria</div>
                </div>
              </div>
              <div class="card" style="margin-top:12px;">
                <h4>Staff view</h4>
                <div class="p">Assigned tasks are grouped by hotel and prioritized.</div>
              </div>
            </div>
          </div>
        </div>
      `
    },
    {
      id: 'tasks-b',
      kicker: 'Proof & history',
      title: 'Done → logged → traceable.',
      subtitle:
        'Every completion can include notes and photos. Later, you can prove what was done and when.',
      bullets: [
        'Timeline of actions',
        'Optional photo proof',
        'Audit-friendly history'
      ],
      screenTitle: 'Task • History',
      screenPill: 'Logged',
      screenHtml: `
        <div class="mock-app">
          <div class="mock-side">
            <div class="navitem"><i class="fa-solid fa-sitemap"></i> Setup</div>
            <div class="navitem"><i class="fa-solid fa-calendar-check"></i> Planning</div>
            <div class="navitem active"><i class="fa-solid fa-list-check"></i> Tasks</div>
            <div class="navitem"><i class="fa-solid fa-chart-line"></i> Reports</div>
          </div>
          <div class="mock-main">
            <div class="mock-main-inner">
              <div class="card">
                <h4>Room 203 • Carpet spot clean</h4>
                <div class="badge-note"><i class="fa-solid fa-circle-check"></i> Status: DONE</div>
              </div>
              <div class="card" style="margin-top:12px;">
                <h4>Timeline</h4>
                <div class="timeline" style="margin-top:10px;">
                  <div class="event"><div class="dot2"></div><div><b>Task created</b><small>Manager • “Red wine stain near entrance.”</small></div></div>
                  <div class="event"><div class="dot2 warn"></div><div><b>Work started</b><small>Maria • 10:42 AM</small></div></div>
                  <div class="event"><div class="dot2 good"></div><div><b>Completed</b><small>Maria • 11:08 AM • “Removed stain. Carpet looks clean.”</small></div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `
    },
    {
      id: 'reports',
      kicker: 'Reports',
      title: 'Reports and roadmaps — without extra work.',
      subtitle:
        'See annual activity (Carpet vs Tile), then generate a daily roadmap for the next cleaning session.',
      bullets: [
        'Annual summary by surface type',
        'Printable roadmap for the day',
        'Better consistency, less stress'
      ],
      screenTitle: 'Reports • Overview',
      screenPill: 'Export-ready',
      screenHtml: `
        <div class="mock-app">
          <div class="mock-side">
            <div class="navitem"><i class="fa-solid fa-sitemap"></i> Setup</div>
            <div class="navitem"><i class="fa-solid fa-calendar-check"></i> Planning</div>
            <div class="navitem"><i class="fa-solid fa-list-check"></i> Tasks</div>
            <div class="navitem active"><i class="fa-solid fa-chart-line"></i> Reports</div>
          </div>
          <div class="mock-main">
            <div class="mock-main-inner">
              <div class="grid2">
                <div class="card">
                  <h4>Annual deep-clean (example)</h4>
                  <div class="bars" style="margin-top:10px;">
                    <div class="bar"><span>Carpet</span><div class="track"><div class="fill" style="width:72%"></div></div></div>
                    <div class="bar"><span>Tile</span><div class="track"><div class="fill" style="width:58%"></div></div></div>
                    <div class="bar"><span>Both</span><div class="track"><div class="fill" style="width:38%"></div></div></div>
                  </div>
                  <p class="p" style="margin-top:12px;">Export monthly / yearly for operations review.</p>
                </div>
                <div class="card">
                  <h4>Today’s roadmap</h4>
                  <div class="p"><b>Start:</b> Floor 2 (Rooms 201–212)</div>
                  <div class="p"><b>Focus:</b> Overdue rooms first</div>
                  <div class="badge-note" style="margin-top:10px;"><i class="fa-solid fa-print"></i> Print or share as PDF</div>
                </div>
              </div>
              <div class="cta-card" style="margin-top:12px;">
                <div>
                  <b>Want this for your hotel?</b>
                  <small>We can onboard your structure, train staff, and help you go live quickly.</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      `
    }
  ];

  let index = 0;

  function setStep(newIndex, { fromHash = false } = {}) {
    index = Math.max(0, Math.min(steps.length - 1, newIndex));
    const step = steps[index];

    const title = $('#demoTitle');
    const sub = $('#demoSubtitle');
    const kicker = $('#demoKicker');
    const bullets = $('#demoBullets');
    const screenTitle = $('#screenTitle');
    const screenPill = $('#screenPill');
    const screenBody = $('#screenBody');

    kicker.innerHTML = `<i class="fa-solid fa-bolt"></i><span>${step.kicker}</span>`;
    title.textContent = step.title;
    sub.textContent = step.subtitle;
    bullets.innerHTML = step.bullets.map((b) => `<li><i class="fa-solid fa-check"></i><span>${b}</span></li>`).join('');

    screenTitle.textContent = step.screenTitle;
    screenPill.textContent = step.screenPill;
    screenBody.innerHTML = `<div class="fade">${step.screenHtml}</div>`;

    const dots = $('#demoDots');
    dots.innerHTML = steps.map((_, i) => `<span class="dot ${i === index ? 'active' : ''}"></span>`).join('');
    $('#demoStepLabel').textContent = `Step ${index + 1} of ${steps.length}`;

    $('#btnPrev').disabled = index === 0;
    $('#btnNext').textContent = index === steps.length - 1 ? 'Finish' : 'Next';

    if (!fromHash) {
      const nextHash = `#${step.id}`;
      if (window.location.hash !== nextHash) window.location.hash = nextHash;
    }
  }

  function hashToIndex() {
    const raw = (window.location.hash || '').replace('#', '').trim();
    if (!raw) return 0;
    const idx = steps.findIndex((s) => s.id === raw);
    return idx >= 0 ? idx : 0;
  }

  function next() {
    if (index >= steps.length - 1) {
      window.location.href = 'hotel.html#contact';
      return;
    }
    setStep(index + 1);
  }
  function prev() {
    setStep(index - 1);
  }

  function init() {
    $('#btnPrev').addEventListener('click', prev);
    $('#btnNext').addEventListener('click', next);
    $('#btnSkip').addEventListener('click', () => setStep(steps.length - 1));
    $('#btnExit').addEventListener('click', () => (window.location.href = 'hotel.html'));

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'Escape') window.location.href = 'hotel.html';
    });

    window.addEventListener('hashchange', () => {
      const idx = hashToIndex();
      setStep(idx, { fromHash: true });
    });

    setStep(hashToIndex(), { fromHash: true });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

