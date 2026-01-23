import { Router, type Response } from 'express';
import { google } from 'googleapis';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';
import { createGoogleOAuthClient, readGoogleEnv } from '../services/googleGmail';

const router = Router();

function normalizeText(v: any) {
  return String(v || '').trim();
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

router.get(
  '/crm/leads/:leadId/inbox',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const prisma = getPrisma();
    const leadId = normalizeText(req.params.leadId);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));

    const lead = await prisma.crmLead.findFirst({
      where: { id: leadId, organizationId: req.auth!.organizationId },
      select: { id: true }
    });
    if (!lead) return res.status(404).json({ error: 'lead_not_found' });

    const emails = await prisma.crmInboundEmail.findMany({
      where: { organizationId: req.auth!.organizationId, leadId },
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
  }
);

router.post(
  '/crm/inbound-emails/:inboundEmailId/reply',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const prisma = getPrisma();
    const env = readGoogleEnv();

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
  }
);

export default router;

