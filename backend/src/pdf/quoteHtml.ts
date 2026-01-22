export type QuotePayload = any;

type Brand = {
  name: string;
  address1: string;
  address2: string;
  phone: string;
  email: string;
  website: string;
};

export type QuoteAcceptance = {
  acceptedAt: Date;
  acceptedPlanKey: 'ondemand' | 'partner' | 'total';
  signedByName: string;
  signedByTitle: string;
  signedByEmail: string;
};

export type QuoteComputed = {
  hotelName: string;
  hotelAddress: string;
  hotelTel: string;
  hotelContact: string;
  hotelEmail: string;
  roomsCalculated: number;
  roomsFinal: number;
  corridorSqft: number;
  currentFreqLabel: string;
};

function escapeHtml(value: any) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderQuoteHtml(opts: {
  brand: Brand;
  logoDataUri: string | null;
  quoteNumber: number | null;
  nowLabel: string;
  customer: { company?: string; contact?: string; email?: string; phone?: string };
  title: string;
  payload: QuotePayload;
  computed: QuoteComputed;
  acceptance?: QuoteAcceptance | null;
}) {
  const { brand, logoDataUri, quoteNumber, nowLabel, customer, title, computed, payload, acceptance } = opts;

  const company = String(customer?.company || computed.hotelName || title || '').trim();
  const contact = String(customer?.contact || computed.hotelContact || '').trim();
  const email = String(customer?.email || computed.hotelEmail || '').trim();
  const phone = String(customer?.phone || computed.hotelTel || '').trim();
  const acceptedKey = String(acceptance?.acceptedPlanKey || '').trim();

  const plans = (payload && typeof payload === 'object' ? (payload as any).pricing?.plans : null) || {};
  const planRoom = (key: 'ondemand' | 'partner' | 'total') => {
    const p = plans?.[key] || {};
    const r = p.room || {};
    return { carpet: Number(r.carpet) || 0, tile: Number(r.tile) || 0, both: Number(r.both) || 0 };
  };
  const planSqft = (key: 'ondemand' | 'partner' | 'total') => {
    const p = plans?.[key] || {};
    return {
      carpetSqft: Number(p.carpetSqft ?? p.carpetSqftPrice ?? p.corridorSqft) || 0,
      tileSqft: Number(p.tileSqft ?? p.tileSqftPrice ?? p.corridorSqft) || 0
    };
  };

  const offerCopy = (key: 'ondemand' | 'partner' | 'total') => {
    if (key === 'ondemand') return { title: 'On‑Demand', condition: 'No obligation / no commitment.' };
    if (key === 'partner') return { title: 'Refresh Plan', condition: 'Minimum 50% of rooms completed within 6 months.' };
    return { title: 'Total Care', condition: 'Minimum 90% of rooms completed within 6 months.' };
  };

  const money = (n: number) =>
    Number.isFinite(n) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n) : '—';
  const usd2 = (n: number) => (Number.isFinite(n) ? `$${Number(n).toFixed(2)}` : '—');
  const num0 = (n: number) => (Number.isFinite(n) ? new Intl.NumberFormat('en-US').format(Math.round(n)) : '—');

  const rows = (['ondemand', 'partner', 'total'] as const).map((key) => {
    const copy = offerCopy(key);
    const r = planRoom(key);
    const s = planSqft(key);
    const selected = acceptance && acceptedKey === key;
    return `
      <tr class="${selected ? 'selected' : ''}">
        <td class="plan">${escapeHtml(copy.title)}</td>
        <td class="num">${escapeHtml(money(r.carpet))}</td>
        <td class="num">${escapeHtml(money(r.tile))}</td>
        <td class="num strong">${escapeHtml(money(r.both))}</td>
        <td class="num">${escapeHtml(usd2(s.carpetSqft))}</td>
        <td class="num">${escapeHtml(usd2(s.tileSqft))}</td>
      </tr>
    `;
  });

  const signatureBlock = acceptance
    ? `
      <div class="section">
        <div class="h2">Digital signature</div>
        <div class="sigBox">
          <div><span class="k">Signed by</span><span class="v">${escapeHtml(acceptance.signedByName)}${acceptance.signedByTitle ? ` (${escapeHtml(acceptance.signedByTitle)})` : ''}</span></div>
          <div><span class="k">Email</span><span class="v">${escapeHtml(acceptance.signedByEmail)}</span></div>
          <div><span class="k">Timestamp (UTC)</span><span class="v mono">${escapeHtml(acceptance.acceptedAt.toISOString())}</span></div>
          <div class="muted">Selected offer is highlighted in the pricing table above.</div>
        </div>
      </div>
    `
    : `
      <div class="muted" style="margin-top:10px;">
        To approve: choose a plan and sign digitally using the secure link.
      </div>
    `;

  const html = `<!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Quote</title>
    <style>
      @page { size: Letter; margin: 0.65in; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Noto Sans", "Liberation Sans", sans-serif;
        color: #111827;
        font-size: 11px;
      }
      .muted { color: #6b7280; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      .page { width: 100%; }
      .top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding-bottom: 10px;
        border-bottom: 1px solid #e5e7eb;
      }
      .brand {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        min-width: 0;
        flex: 1;
      }
      .logo {
        width: 120px;
        height: 44px;
        object-fit: contain;
        display: block;
      }
      .brandText { min-width: 0; }
      .brandName { font-size: 14px; font-weight: 800; line-height: 1.1; }
      .brandMeta { margin-top: 3px; line-height: 1.35; }
      .docId { text-align: right; min-width: 180px; }
      .docTitle { font-size: 26px; font-weight: 900; line-height: 1; margin: 0; }
      .docMeta { margin-top: 6px; font-size: 11px; font-weight: 700; color: #6b7280; }

      .section { margin-top: 14px; }
      .h2 { font-size: 12px; font-weight: 900; margin: 0 0 6px; }

      .grid2 { display: grid; grid-template-columns: 1fr; gap: 12px; }
      .box {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 12px;
      }
      .kv { display: grid; grid-template-columns: 190px 1fr; row-gap: 6px; column-gap: 10px; }
      .kv .k { color:#6b7280; font-weight: 800; }
      .kv .v { text-align: right; font-weight: 900; }

      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      thead th {
        font-size: 10px;
        letter-spacing: 0.02em;
        text-transform: none;
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        padding: 8px 10px;
        text-align: right;
        white-space: nowrap;
      }
      thead th:first-child { text-align: left; }
      tbody td {
        border: 1px solid #e5e7eb;
        padding: 8px 10px;
        vertical-align: middle;
      }
      tbody td.plan { font-weight: 900; }
      tbody td.num { text-align: right; font-weight: 800; }
      tbody td.strong { font-weight: 950; }
      tr.selected { outline: 2px solid #0b6b55; outline-offset: -2px; }

      .note { margin-top: 8px; font-size: 10px; color: #6b7280; line-height: 1.35; }

      .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
      .bullets { margin: 6px 0 0; padding-left: 14px; color:#374151; }
      .bullets li { margin: 3px 0; }

      .sigBox {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 12px;
      }
      .sigBox > div { display:flex; justify-content:space-between; gap:12px; padding: 4px 0; }
      .sigBox .k { color:#6b7280; font-weight: 850; }
      .sigBox .v { font-weight: 900; }

      .footer {
        margin-top: 16px;
        padding-top: 10px;
        border-top: 1px solid #e5e7eb;
        font-size: 9px;
        color: #6b7280;
        line-height: 1.35;
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="top">
        <div class="brand">
          ${logoDataUri ? `<img class="logo" src="${escapeHtml(logoDataUri)}" alt="Logo" />` : ''}
          <div class="brandText">
            <div class="brandName">${escapeHtml(brand.name)}</div>
            <div class="brandMeta muted">
              ${escapeHtml(brand.address1)}<br/>
              ${escapeHtml(brand.address2)}<br/>
              ${escapeHtml(brand.phone)} · ${escapeHtml(brand.email)} · ${escapeHtml(brand.website)}
            </div>
          </div>
        </div>
        <div class="docId">
          <div class="docTitle">Quote</div>
          <div class="docMeta">${escapeHtml([quoteNumber ? `#${quoteNumber}` : null, nowLabel].filter(Boolean).join(' · '))}</div>
        </div>
      </div>

      <div class="section">
        <div class="h2">Customer</div>
        <div class="box">
          <div style="font-weight:900; font-size:12px;">${escapeHtml(company || '—')}</div>
          <div class="muted" style="margin-top:4px; line-height:1.35;">
            ${escapeHtml(contact)}${contact ? '<br/>' : ''}
            ${escapeHtml(email)}${email ? '<br/>' : ''}
            ${escapeHtml(phone)}${phone ? '<br/>' : ''}
            ${escapeHtml(computed.hotelAddress)}
          </div>
        </div>
      </div>

      <div class="section">
        <div class="h2">Scope</div>
        <div class="box">
          <div class="kv">
            <div class="k">Rooms</div><div class="v">${escapeHtml(num0(computed.roomsFinal))}</div>
            <div class="k">Corridor sqft</div><div class="v">${escapeHtml(num0(computed.corridorSqft))}</div>
            <div class="k">Current cleaning frequency</div><div class="v">${escapeHtml(computed.currentFreqLabel || '—')}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="h2">Plans & pricing</div>
        <div class="muted">Fixed pricing per room + per sqft for common areas.</div>
        <div style="margin-top:8px;">
          <table>
            <thead>
              <tr>
                <th style="width: 22%;">Plan</th>
                <th style="width: 13%;">Carpet/room</th>
                <th style="width: 13%;">Tile/room</th>
                <th style="width: 14%;">Special (Both)</th>
                <th style="width: 18%;">Carpet $/sqft</th>
                <th style="width: 20%;">Tile $/sqft</th>
              </tr>
            </thead>
            <tbody>
              ${rows.join('')}
            </tbody>
          </table>
        </div>
        <div class="note">
          Note: Special (Both) applies when a room includes carpet + tile surfaces.<br/>
          Common areas billed per square foot (corridor, meeting room, hall, lobby).
        </div>
        <div class="note" style="margin-top:8px;">
          <b>Plan conditions</b><br/>
          ${(['ondemand', 'partner', 'total'] as const)
            .map((k) => {
              const c = offerCopy(k);
              return `• ${escapeHtml(c.title)}: ${escapeHtml(c.condition)}`;
            })
            .join('<br/>')}
        </div>
      </div>

      <div class="section">
        <div class="h2">Service & process</div>
        <div class="muted">Designed for hotel operations: fast turnaround, consistent results, and minimal disruption.</div>
        <div class="cols" style="margin-top:8px;">
          <div>
            <div style="font-weight:900;">Tile &amp; grout</div>
            <ul class="bullets">
              <li>Detergent solution</li>
              <li>Hard stiff brushing</li>
              <li>1200 PSI rinse / extraction</li>
            </ul>
          </div>
          <div>
            <div style="font-weight:900;">Carpet cleaning</div>
            <ul class="bullets">
              <li>Detergent Pro Encapsulation</li>
              <li>Odor neutralizer</li>
              <li>High-agitation brushing process</li>
              <li>Commercial fiber protectant</li>
            </ul>
          </div>
        </div>
        <div style="margin-top:8px; font-weight:900; color:#0b6b55;">30–40 minutes per room · Ready after ~1 hour</div>
      </div>

      <div class="section">
        <div class="h2">Terms</div>
        <div class="muted">
          Pricing is subject to the agreed scope and conditions. Final quantities and any special constraints may be confirmed after on-site validation.
        </div>
        ${signatureBlock}
      </div>

      <div class="footer">
        ${escapeHtml(brand.name)} · ${escapeHtml(brand.address1)} · ${escapeHtml(brand.address2)} · ${escapeHtml(brand.phone)} · ${escapeHtml(brand.email)}
      </div>
    </div>
  </body>
  </html>`;

  return html;
}
