import { Router, type Response } from 'express';
import { google } from 'googleapis';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';
import { createGoogleOAuthClient, readGoogleEnv } from '../services/googleGmail';

const router = Router();

const asyncHandler =
  (fn: any) =>
  (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

function normalizeText(v: any) {
  return String(v || '').trim();
}

function safeReadGoogleEnv(): ReturnType<typeof readGoogleEnv> | null {
  try {
    return readGoogleEnv();
  } catch {
    return null;
  }
}

function extractEmailAddress(v: string) {
  const s = String(v || '').trim();
  const m = s.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  const token = s.split(/\s+/)[0] || '';
  return token.replace(/^"|"$/g, '').trim();
}

function base64UrlEncodeUtf8(s: string) {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getHeaderValue(rawHeaders: any, name: string) {
  const headers = Array.isArray(rawHeaders) ? rawHeaders : [];
  const n = name.toLowerCase();
  const h = headers.find((x) => String(x?.name || '').toLowerCase() === n);
  return normalizeText(h?.value);
}

function decodeBase64Url(data: string) {
  const s = String(data || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return Buffer.from(s + pad, 'base64').toString('utf8');
}

function extractBodiesFromPayload(payload: any): { text: string; html: string } {
  let text = '';
  let html = '';

  const walk = (part: any) => {
    if (!part) return;
    const mimeType = normalizeText(part?.mimeType).toLowerCase();
    const data = normalizeText(part?.body?.data);
    if (data) {
      const decoded = decodeBase64Url(data);
      if (mimeType === 'text/plain' && !text) text = decoded;
      if (mimeType === 'text/html' && !html) html = decoded;
    }
    const parts = Array.isArray(part?.parts) ? part.parts : [];
    for (const p of parts) walk(p);
  };

  walk(payload);
  return { text: text.trim(), html: html.trim() };
}

function clampText(s: string, max = 200_000) {
  const v = String(s || '');
  if (v.length <= max) return v;
  return v.slice(0, max);
}

function parseReferences(refsRaw: string) {
  const matches = String(refsRaw || '').match(/<[^>]+>/g) || [];
  return matches.map((x) => x.trim());
}

function parseReplyToLeadCampaignId(toRaw: string) {
  const m = String(toRaw || '').match(/\+lc_([a-z0-9]+)@/i);
  return m ? normalizeText(m[1]) : '';
}

async function markLeadCampaignReplied(organizationId: string, leadCampaignId: string) {
  const prisma = getPrisma();
  const lc = await prisma.crmLeadCampaign.findFirst({ where: { id: leadCampaignId, organizationId } });
  if (!lc) return;
  if (lc.archivedAt) return;

  await prisma.$transaction(async (tx) => {
    await tx.crmLead.update({
      where: { id: lc.leadId },
      data: { archivedAt: new Date(), archiveReason: 'REPLIED_AUTO' as any }
    });
    await tx.crmLeadCampaign.update({
      where: { id: lc.id },
      data: { archivedAt: new Date(), archiveReason: 'REPLIED_AUTO' as any, awaitingValidation: false, nextSendAt: null }
    });
    await tx.crmEmailMessage.updateMany({
      where: { leadCampaignId: lc.id, status: { in: ['SCHEDULED', 'SENDING'] } },
      data: { status: 'CANCELED' }
    });
  });
}

router.get(
  '/crm/leads/:leadId/inbox',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const prisma = getPrisma();
    const leadId = normalizeText(req.params.leadId);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));

    const lead = await prisma.crmLead.findFirst({
      where: { id: leadId, organizationId: req.auth!.organizationId },
      select: { id: true }
    });
    if (!lead) return res.status(404).json({ error: 'lead_not_found' });

    // Some ingestion paths (Pub/Sub push) may not know the leadId and only attach leadCampaignId.
    const leadCampaignIds = await prisma.crmLeadCampaign
      .findMany({
        where: { organizationId: req.auth!.organizationId, leadId },
        select: { id: true }
      })
      .then((rows) => rows.map((r) => r.id));

    const emails = await prisma.crmInboundEmail.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        OR: [
          { leadId },
          ...(leadCampaignIds.length ? [{ leadCampaignId: { in: leadCampaignIds } }] : [])
        ]
      },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit
    });

    res.json({
      emails: emails.map((e) => ({
        id: e.id,
        fromEmail: e.fromEmail,
        toEmail: e.toEmail,
        subject: e.subject,
        snippet: e.snippet,
        bodyText: e.bodyText,
        bodyHtml: e.bodyHtml,
        receivedAt: e.receivedAt,
        threadId: e.threadId
      }))
    });
  })
);

router.post(
  '/crm/leads/:leadId/inbox/sync',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const env = safeReadGoogleEnv();
    if (!env) return res.status(400).json({ error: 'google_not_configured' });

    const prisma = getPrisma();
    const leadId = normalizeText(req.params.leadId);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));

    const lead = await prisma.crmLead.findFirst({
      where: { id: leadId, organizationId: req.auth!.organizationId },
      select: { id: true, email1: true, email2: true }
    });
    if (!lead) return res.status(404).json({ error: 'lead_not_found' });

    const account = await prisma.googleGmailAccount.findFirst({
      where: { email: env.workspaceEmail, organizationId: req.auth!.organizationId }
    });
    if (!account) return res.status(400).json({ error: 'gmail_not_connected' });

    const emails = [normalizeText(lead.email1), normalizeText(lead.email2)].filter(Boolean);
    if (!emails.length) return res.status(400).json({ error: 'lead_missing_email' });

    const oauth2Client = createGoogleOAuthClient(env);
    oauth2Client.setCredentials({ refresh_token: account.refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const q = emails.map((e) => `from:${e}`).join(' OR ');
    const listed = await gmail.users.messages.list({
      userId: 'me',
      q: `(${q})`,
      maxResults: limit
    });
    const msgIds = (listed.data.messages || []).map((m) => normalizeText(m?.id)).filter(Boolean);
    if (!msgIds.length) return res.json({ ok: true, synced: 0 });

    let createdCount = 0;
    for (const msgId of msgIds) {
      try {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: msgId,
          format: 'full'
        });

        const headers = (msg.data.payload as any)?.headers || [];
        const from = getHeaderValue(headers, 'From');
        const to = getHeaderValue(headers, 'To');
        const cc = getHeaderValue(headers, 'Cc');
        const subject = getHeaderValue(headers, 'Subject');
        const date = getHeaderValue(headers, 'Date');
        const inReplyTo = getHeaderValue(headers, 'In-Reply-To');
        const references = getHeaderValue(headers, 'References');

        const toCombined = `${to} ${cc}`.trim();
        let leadCampaignId = parseReplyToLeadCampaignId(toCombined);
        if (!leadCampaignId) {
          const refs = Array.from(new Set([...parseReferences(references), ...parseReferences(inReplyTo)]));
          if (refs.length) {
            const mapped = await prisma.crmEmailMessage.findFirst({
              where: { organizationId: req.auth!.organizationId, providerMessageId: { in: refs } },
              select: { leadCampaignId: true }
            });
            leadCampaignId = normalizeText(mapped?.leadCampaignId || '');
          }
        }

        const snippet = normalizeText((msg.data as any).snippet);
        const threadId = normalizeText((msg.data as any).threadId);
        const bodies = extractBodiesFromPayload(msg.data.payload as any);
        const bodyText = clampText(bodies.text || snippet);
        const bodyHtml = clampText(bodies.html);

        await prisma.crmInboundEmail.upsert({
          where: { provider_providerMessageId: { provider: 'gmail', providerMessageId: msgId } },
          create: {
            organizationId: req.auth!.organizationId,
            leadId: lead.id,
            leadCampaignId: leadCampaignId || undefined,
            provider: 'gmail',
            providerMessageId: msgId,
            threadId: threadId || undefined,
            fromEmail: from,
            toEmail: toCombined,
            subject,
            snippet,
            bodyText,
            bodyHtml: bodyHtml || undefined,
            receivedAt: date ? new Date(date) : undefined,
            rawHeaders: headers as any
          },
          update: {
            leadId: lead.id,
            leadCampaignId: leadCampaignId || undefined,
            threadId: threadId || undefined,
            fromEmail: from,
            toEmail: toCombined,
            subject,
            snippet,
            bodyText,
            bodyHtml: bodyHtml || undefined,
            receivedAt: date ? new Date(date) : undefined,
            rawHeaders: headers as any
          }
        });
        createdCount += 1;

        if (leadCampaignId) {
          await markLeadCampaignReplied(req.auth!.organizationId, leadCampaignId);
        }
      } catch {
        // ignore per-message errors / duplicates
      }
    }

    res.json({ ok: true, synced: createdCount });
  })
);

router.post(
  '/crm/inbound-emails/:inboundEmailId/reply',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const prisma = getPrisma();
    const env = safeReadGoogleEnv();
    if (!env) return res.status(400).json({ error: 'google_not_configured' });

    const inboundEmailId = normalizeText(req.params.inboundEmailId);
    const text = normalizeText(req.body?.text);
    if (!text) return res.status(400).json({ error: 'missing_text' });

    const inbound = await prisma.crmInboundEmail.findFirst({
      where: { id: inboundEmailId, organizationId: req.auth!.organizationId }
    });
    if (!inbound) return res.status(404).json({ error: 'inbound_email_not_found' });

    const account = await prisma.googleGmailAccount.findFirst({
      where: { email: env.workspaceEmail, organizationId: req.auth!.organizationId }
    });
    if (!account) return res.status(400).json({ error: 'gmail_not_connected' });

    const to = extractEmailAddress(inbound.fromEmail);
    if (!to) return res.status(400).json({ error: 'missing_to_address' });

    const subjectBase = normalizeText(inbound.subject) || 'Re:';
    const subject = /^re:/i.test(subjectBase) ? subjectBase : `Re: ${subjectBase}`;

    const inReplyTo = getHeaderValue(inbound.rawHeaders as any, 'Message-Id');
    const references = getHeaderValue(inbound.rawHeaders as any, 'References');
    const refs = [references, inReplyTo].filter(Boolean).join(' ').trim();

    const headers: string[] = [];
    headers.push(`From: ${env.workspaceEmail}`);
    headers.push(`To: ${to}`);
    headers.push(`Subject: ${subject}`);
    headers.push('MIME-Version: 1.0');
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
    if (refs) headers.push(`References: ${refs}`);

    const raw = `${headers.join('\r\n')}\r\n\r\n${text}\r\n`;

    const oauth2Client = createGoogleOAuthClient(env);
    oauth2Client.setCredentials({ refresh_token: account.refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const resp = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: base64UrlEncodeUtf8(raw),
        ...(inbound.threadId ? { threadId: inbound.threadId } : {})
      }
    });

    res.json({ ok: true, gmailMessageId: resp.data.id || null, threadId: resp.data.threadId || inbound.threadId || null });
  })
);

export default router;
