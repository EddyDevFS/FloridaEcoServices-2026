import { getPrisma } from '../db';
import { sendMail } from '../email/mailer';

function apiBaseUrl() {
  const raw = String(process.env.PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
  if (raw) return raw;
  const port = Number(process.env.PORT || 3001);
  return `http://localhost:${port}`;
}

function normalizeText(v: any) {
  return String(v || '').trim();
}

function buildReplyToForLeadCampaign(leadCampaignId: string) {
  const smtpUser = normalizeText(process.env.SMTP_USER);
  if (!smtpUser || !smtpUser.includes('@')) return null;
  const [local, domain] = smtpUser.split('@');
  if (!local || !domain) return null;
  return `${local}+lc_${leadCampaignId}@${domain}`;
}

function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function textToHtml(text: string) {
  const safe = escapeHtml(String(text || ''));
  const withBreaks = safe.replace(/\n/g, '<br>');
  return `<div style="font-family: ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial; font-size:14px; line-height:1.5;">${withBreaks}</div>`;
}

function withOpenTracking(html: string, messageId: string) {
  const src = `${apiBaseUrl()}/t/pixel?mid=${encodeURIComponent(messageId)}`;
  const pixel = `<img src="${src}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;opacity:0" />`;
  return `${html}${pixel}`;
}

function withClickTrackingUrl(url: string, messageId: string) {
  const u = `${apiBaseUrl()}/t/click?mid=${encodeURIComponent(messageId)}&url=${encodeURIComponent(url)}`;
  return u;
}

function linkifyTextToHtml(text: string, messageId: string) {
  const raw = String(text || '');
  const urlRe = /\bhttps?:\/\/[^\s<>"')]+/gi;
  let out = '';
  let lastIndex = 0;

  for (;;) {
    const m = urlRe.exec(raw);
    if (!m) break;
    const url = m[0];
    const start = m.index;
    out += escapeHtml(raw.slice(lastIndex, start));
    const tracked = withClickTrackingUrl(url, messageId);
    out += `<a href="${escapeHtml(tracked)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    lastIndex = start + url.length;
  }
  out += escapeHtml(raw.slice(lastIndex));
  out = out.replace(/\n/g, '<br>');

  return `<div style="font-family: ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial; font-size:14px; line-height:1.5;">${out}</div>`;
}

function rewriteHtmlLinks(html: string, messageId: string) {
  const raw = String(html || '');
  return raw.replace(/href=(["'])(https?:\/\/[^"']+)\1/gi, (_m, q, url) => {
    const tracked = withClickTrackingUrl(String(url), messageId);
    return `href=${q}${tracked}${q}`;
  });
}

function classifyError(err: any) {
  return {
    name: normalizeText(err?.name || ''),
    code: normalizeText(err?.code || err?.responseCode || ''),
    message: normalizeText(err?.message || 'unknown_error')
  };
}

async function claimDueMessages(limit: number, instanceId: string) {
  const prisma = getPrisma();
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `
    UPDATE "CrmEmailMessage" m
    SET
      "status" = 'SENDING',
      "lockedAt" = NOW(),
      "lockedBy" = $1,
      "attempts" = "attempts" + 1,
      "updatedAt" = NOW()
    WHERE m."id" IN (
      SELECT m2."id"
      FROM "CrmEmailMessage" m2
      WHERE
        m2."status" = 'SCHEDULED'
        AND m2."sendAt" <= NOW()
        AND (
          m2."lockedAt" IS NULL
          OR m2."lockedAt" < NOW() - INTERVAL '15 minutes'
        )
      ORDER BY m2."sendAt" ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    )
    RETURNING m.*;
    `,
    instanceId,
    limit
  );
  return rows || [];
}

async function markSent(messageId: string, providerMessageId: string | null) {
  const prisma = getPrisma();
  const msg = await prisma.crmEmailMessage.update({
    where: { id: messageId },
    data: {
      status: 'SENT',
      sentAt: new Date(),
      providerMessageId: providerMessageId || null,
      lockedAt: null,
      lockedBy: null
    }
  });
  await prisma.crmEmailEvent.create({
    data: { messageId: msg.id, type: 'SENT' }
  });
  return msg;
}

async function markFailed(messageId: string, err: any) {
  const prisma = getPrisma();
  const e = classifyError(err);
  const msg = await prisma.crmEmailMessage.findFirst({ where: { id: messageId } });
  if (!msg) return;

  const attempts = msg.attempts || 0;
  const isPermanent = e.message === 'smtp_not_configured';
  const shouldRetry = !isPermanent && attempts < 3;
  const nextSendAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.crmEmailMessage.update({
    where: { id: msg.id },
    data: {
      status: shouldRetry ? 'SCHEDULED' : 'FAILED',
      sendAt: shouldRetry ? nextSendAt : msg.sendAt,
      lockedAt: null,
      lockedBy: null,
      lastError: e as any
    }
  });

  await prisma.crmEmailEvent.create({
    data: { messageId: msg.id, type: 'ERROR', url: '', ip: '', userAgent: '', at: new Date() }
  });
}

async function updateLeadCampaignAfterSend(message: any) {
  const prisma = getPrisma();
  const lc = await prisma.crmLeadCampaign.findFirst({
    where: { id: message.leadCampaignId },
    include: { campaign: { include: { emails: { orderBy: { stepIndex: 'asc' } } } } }
  });
  if (!lc) return;

  const stepsCount = lc.campaign.emails.length;
  const isLast = Number(message.stepIndex) >= stepsCount;

  if (isLast) {
    await prisma.$transaction(async (tx) => {
      await tx.crmLead.update({
        where: { id: lc.leadId },
        data: { archivedAt: new Date(), archiveReason: 'NO_RESPONSE_END' }
      });
      await tx.crmLeadCampaign.update({
        where: { id: lc.id },
        data: {
          lastSentStep: Number(message.stepIndex),
          awaitingValidation: false,
          nextSendAt: null,
          archivedAt: new Date(),
          archiveReason: 'NO_RESPONSE_END'
        }
      });
    });
    return;
  }

  await prisma.crmLeadCampaign.update({
    where: { id: lc.id },
    data: {
      lastSentStep: Number(message.stepIndex),
      awaitingValidation: true,
      nextSendAt: null
    }
  });
}

async function sendOne(message: any) {
  const prisma = getPrisma();
  const full = await prisma.crmEmailMessage.findFirst({
    where: { id: String(message.id) },
    include: {
      leadCampaign: { include: { campaign: true, lead: true } }
    }
  });
  if (!full) return;

  if (full.status !== 'SENDING') return;
  if (full.leadCampaign.archivedAt || full.leadCampaign.lead.archivedAt || full.leadCampaign.campaign.status !== 'READY') {
    await prisma.crmEmailMessage.update({
      where: { id: full.id },
      data: { status: 'CANCELED', lockedAt: null, lockedBy: null }
    });
    return;
  }

  const baseHtml = full.bodyHtml
    ? rewriteHtmlLinks(String(full.bodyHtml), String(full.id))
    : linkifyTextToHtml(String(full.bodyText || ''), String(full.id));
  const html = withOpenTracking(baseHtml, String(full.id));
  const text = String(full.bodyText || '');

  const replyTo = buildReplyToForLeadCampaign(String(full.leadCampaignId));
  const info = await sendMail({
    to: [String(full.toEmail)],
    subject: String(full.subject),
    text,
    html,
    replyTo: replyTo || undefined,
    headers: {
      'X-Crm-Lead-Campaign-Id': String(full.leadCampaignId),
      'X-Crm-Email-Message-Id': String(full.id)
    }
  });

  const providerMessageId = normalizeText((info as any)?.messageId || '');
  const sent = await markSent(String(full.id), providerMessageId || null);
  await updateLeadCampaignAfterSend(sent);
}

export function startCrmEmailWorker() {
  const instanceId = normalizeText(process.env.INSTANCE_ID || '') || `api_${process.pid}`;
  const intervalMs = Math.max(5_000, Number(process.env.CRM_WORKER_INTERVAL_MS || 10_000));
  const batchSize = Math.max(1, Math.min(25, Number(process.env.CRM_WORKER_BATCH || 10)));

  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const claimed = await claimDueMessages(batchSize, instanceId);
      for (const m of claimed) {
        try {
          await sendOne(m);
        } catch (err) {
          console.error('[crm] send failed', m?.id, err);
          await markFailed(String(m.id), err);
        }
      }
    } catch (err) {
      console.error('[crm] worker tick error', err);
    } finally {
      running = false;
    }
  }, intervalMs);

  timer.unref?.();
  console.log(`[crm] worker started interval=${intervalMs}ms batch=${batchSize} instance=${instanceId}`);
}
