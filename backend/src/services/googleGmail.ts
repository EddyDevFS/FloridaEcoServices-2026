import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { getPrisma } from '../db';

export type GoogleEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  workspaceEmail: string;
  pubsubTopic: string;
  pushAudience: string;
  pushServiceAccountEmail: string | null;
};

function normalizeText(v: any) {
  return String(v || '').trim();
}

export function readGoogleEnv(): GoogleEnv {
  const clientId = normalizeText(process.env.GOOGLE_OAUTH_CLIENT_ID);
  const clientSecret = normalizeText(process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  const redirectUri = normalizeText(process.env.GOOGLE_OAUTH_REDIRECT_URI);
  const workspaceEmail = normalizeText(process.env.GOOGLE_WORKSPACE_EMAIL);
  const pubsubTopic = normalizeText(process.env.GOOGLE_GMAIL_PUBSUB_TOPIC);
  const pushAudience = normalizeText(process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE);
  const pushServiceAccountEmail = normalizeText(process.env.GOOGLE_PUBSUB_PUSH_SA_EMAIL) || null;

  if (!clientId) throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID');
  if (!clientSecret) throw new Error('Missing GOOGLE_OAUTH_CLIENT_SECRET');
  if (!redirectUri) throw new Error('Missing GOOGLE_OAUTH_REDIRECT_URI');
  if (!workspaceEmail) throw new Error('Missing GOOGLE_WORKSPACE_EMAIL');
  if (!pubsubTopic) throw new Error('Missing GOOGLE_GMAIL_PUBSUB_TOPIC');
  if (!pushAudience) throw new Error('Missing GOOGLE_PUBSUB_PUSH_AUDIENCE');

  return { clientId, clientSecret, redirectUri, workspaceEmail, pubsubTopic, pushAudience, pushServiceAccountEmail };
}

export function createGoogleOAuthClient(env: GoogleEnv): OAuth2Client {
  return new google.auth.OAuth2(env.clientId, env.clientSecret, env.redirectUri);
}

export function signGoogleOauthState(payload: { organizationId: string; userId: string }) {
  const secret = normalizeText(process.env.JWT_ACCESS_SECRET);
  if (!secret) throw new Error('Missing JWT_ACCESS_SECRET (required for Google OAuth state)');
  return jwt.sign({ ...payload, typ: 'google_oauth' }, secret, { expiresIn: '10m' });
}

export function verifyGoogleOauthState(state: string): { organizationId: string; userId: string } {
  const secret = normalizeText(process.env.JWT_ACCESS_SECRET);
  if (!secret) throw new Error('Missing JWT_ACCESS_SECRET (required for Google OAuth state)');
  const decoded = jwt.verify(state, secret);
  if (!decoded || typeof decoded !== 'object') throw new Error('invalid_state');
  if ((decoded as any).typ !== 'google_oauth') throw new Error('invalid_state');
  const organizationId = normalizeText((decoded as any).organizationId);
  const userId = normalizeText((decoded as any).userId);
  if (!organizationId || !userId) throw new Error('invalid_state');
  return { organizationId, userId };
}

export async function verifyPubSubOidc(req: { authorization?: string }) {
  const env = readGoogleEnv();
  const header = normalizeText(req.authorization);
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) throw new Error('missing_bearer');

  const client = new OAuth2Client();
  const ticket = await client.verifyIdToken({ idToken: token, audience: env.pushAudience });
  const payload = ticket.getPayload() || {};

  const email = normalizeText((payload as any).email);
  const aud = Array.isArray((payload as any).aud) ? (payload as any).aud.join(',') : normalizeText((payload as any).aud);

  if (!aud) throw new Error('invalid_oidc');
  if (env.pushServiceAccountEmail && email !== env.pushServiceAccountEmail) throw new Error('invalid_oidc_email');

  return { email };
}

function extractHeader(headers: any[], name: string) {
  const n = name.toLowerCase();
  const h = (headers || []).find((x) => String(x?.name || '').toLowerCase() === n);
  return normalizeText(h?.value);
}

function parseReplyToLeadCampaignId(toRaw: string) {
  // Expect plus-addressing: eddy+lc_<leadCampaignId>@domain
  const m = String(toRaw || '').match(/\+lc_([a-z0-9]+)@/i);
  return m ? normalizeText(m[1]) : '';
}

async function findLeadCampaignByProviderMessageId(organizationId: string, refs: string[]) {
  const prisma = getPrisma();
  const cleaned = (refs || []).map(normalizeText).filter(Boolean);
  if (!cleaned.length) return null;

  const msg = await prisma.crmEmailMessage.findFirst({
    where: { organizationId, providerMessageId: { in: cleaned } },
    select: { leadCampaignId: true, leadId: true }
  });
  return msg ? { leadCampaignId: msg.leadCampaignId, leadId: msg.leadId } : null;
}

function parseReferences(refsRaw: string) {
  // Message-ID(s) are often like: <abc@domain> <def@domain>
  const matches = String(refsRaw || '').match(/<[^>]+>/g) || [];
  return matches.map((x) => x.trim());
}

async function markLeadCampaignReplied(organizationId: string, leadCampaignId: string, leadId: string | null) {
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

export async function processGmailPushNotification(payload: { emailAddress: string; historyId: string }) {
  const env = readGoogleEnv();
  const prisma = getPrisma();

  const emailAddress = normalizeText(payload.emailAddress);
  const historyId = normalizeText(payload.historyId);
  if (!emailAddress || !historyId) return;

  const account = await prisma.googleGmailAccount.findFirst({ where: { email: emailAddress } });
  if (!account) return;

  const oauth2Client = createGoogleOAuthClient(env);
  oauth2Client.setCredentials({ refresh_token: account.refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  if (!account.lastHistoryId) {
    await prisma.googleGmailAccount.update({ where: { id: account.id }, data: { lastHistoryId: historyId } });
    return;
  }

  const messageIds = new Set<string>();
  try {
    let pageToken: string | undefined = undefined;
    for (;;) {
      const resp = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: account.lastHistoryId,
        historyTypes: ['messageAdded'],
        labelId: 'INBOX',
        pageToken
      });
      const history = resp.data.history || [];
      for (const h of history) {
        const added = (h as any).messagesAdded || [];
        for (const a of added) {
          const id = normalizeText(a?.message?.id);
          if (id) messageIds.add(id);
        }
      }
      pageToken = normalizeText(resp.data.nextPageToken);
      if (!pageToken) break;
    }
  } catch (err) {
    // If history is too old/invalid, reset cursor and wait for next push.
    await prisma.googleGmailAccount.update({ where: { id: account.id }, data: { lastHistoryId: historyId } });
    console.error('[google][gmail] history.list failed; cursor reset', err);
    return;
  }

  // Update lastHistoryId as soon as possible to avoid reprocessing loops.
  await prisma.googleGmailAccount.update({ where: { id: account.id }, data: { lastHistoryId: historyId } });

  for (const msgId of messageIds) {
    try {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: msgId,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date', 'In-Reply-To', 'References', 'Message-Id']
      });

      const headers = (msg.data.payload as any)?.headers || [];
      const from = extractHeader(headers, 'From');
      const to = extractHeader(headers, 'To');
      const cc = extractHeader(headers, 'Cc');
      const subject = extractHeader(headers, 'Subject');
      const date = extractHeader(headers, 'Date');
      const inReplyTo = extractHeader(headers, 'In-Reply-To');
      const references = extractHeader(headers, 'References');

      const toCombined = `${to} ${cc}`.trim();
      let leadCampaignId = parseReplyToLeadCampaignId(toCombined);
      let leadId: string | null = null;

      if (!leadCampaignId) {
        const refs = Array.from(new Set([...parseReferences(references), ...parseReferences(inReplyTo)]));
        const mapped = await findLeadCampaignByProviderMessageId(account.organizationId, refs);
        if (mapped) {
          leadCampaignId = mapped.leadCampaignId;
          leadId = mapped.leadId;
        }
      }

      const snippet = normalizeText((msg.data as any).snippet);
      const threadId = normalizeText((msg.data as any).threadId);

      try {
        await prisma.crmInboundEmail.create({
          data: {
            organizationId: account.organizationId,
            leadId: leadId || undefined,
            leadCampaignId: leadCampaignId || undefined,
            provider: 'gmail',
            providerMessageId: msgId,
            threadId: threadId || undefined,
            fromEmail: from,
            toEmail: toCombined,
            subject,
            snippet,
            receivedAt: date ? new Date(date) : undefined,
            rawHeaders: headers as any
          }
        });
      } catch {
        // duplicate push / already ingested
      }

      if (leadCampaignId) {
        await markLeadCampaignReplied(account.organizationId, leadCampaignId, leadId);
      }
    } catch (err) {
      // Intentionally ignore per-message errors to not block ack.
      console.error('[google][gmail] process message failed', msgId, err);
    }
  }
}
