import { Router, type Request, type Response } from 'express';
import { google } from 'googleapis';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';
import {
  createGoogleOAuthClient,
  readGoogleEnv,
  signGoogleOauthState,
  verifyGoogleOauthState,
  verifyPubSubOidc,
  processGmailPushNotification
} from '../services/googleGmail';

const router = Router();

function normalizeText(v: any) {
  return String(v || '').trim();
}

router.get('/oauth/start', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const env = readGoogleEnv();
  const oauth2Client = createGoogleOAuthClient(env);

  const state = signGoogleOauthState({ organizationId: req.auth!.organizationId, userId: req.auth!.userId });

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    state,
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify'
    ]
  });

  return res.redirect(302, url);
});

router.get('/oauth/callback', async (req: Request, res: Response) => {
  const env = readGoogleEnv();
  const code = normalizeText(req.query?.code);
  const stateRaw = normalizeText(req.query?.state);
  if (!code) return res.status(400).send('Missing code');
  if (!stateRaw) return res.status(400).send('Missing state');

  let state: { organizationId: string; userId: string };
  try {
    state = verifyGoogleOauthState(stateRaw);
  } catch {
    return res.status(400).send('Invalid state');
  }

  const oauth2Client = createGoogleOAuthClient(env);
  const tokenRes = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokenRes.tokens);

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const emailAddress = normalizeText(profile.data.emailAddress);
  if (!emailAddress) return res.status(400).send('Gmail profile has no emailAddress');

  if (emailAddress.toLowerCase() !== env.workspaceEmail.toLowerCase()) {
    return res
      .status(400)
      .send(`Unexpected Gmail account: ${emailAddress}. Expected: ${env.workspaceEmail}.`);
  }

  const refreshToken = normalizeText(tokenRes.tokens.refresh_token);
  const prisma = getPrisma();

  const existing = await prisma.googleGmailAccount.findFirst({ where: { email: emailAddress } });
  if (!refreshToken && !existing) {
    return res
      .status(400)
      .send('No refresh token received. Revoke access in Google Account and retry with prompt=consent.');
  }

  const saved = await prisma.googleGmailAccount.upsert({
    where: { email: emailAddress },
    create: {
      organizationId: state.organizationId,
      email: emailAddress,
      refreshToken: refreshToken || ''
    },
    update: {
      organizationId: state.organizationId,
      refreshToken: refreshToken || existing!.refreshToken
    }
  });

  // Start/refresh Gmail watch -> Pub/Sub
  oauth2Client.setCredentials({ refresh_token: saved.refreshToken });
  const gmail2 = google.gmail({ version: 'v1', auth: oauth2Client });
  const watch = await gmail2.users.watch({
    userId: 'me',
    requestBody: {
      topicName: env.pubsubTopic,
      labelIds: ['INBOX'],
      labelFilterAction: 'include'
    }
  });

  const historyId = normalizeText(watch.data.historyId);
  const expirationMs = Number(watch.data.expiration || 0);
  await prisma.googleGmailAccount.update({
    where: { id: saved.id },
    data: {
      lastHistoryId: historyId || saved.lastHistoryId,
      watchExpiration: expirationMs ? new Date(expirationMs) : saved.watchExpiration
    }
  });

  return res
    .status(200)
    .send('✅ Gmail connecté. Tu peux fermer cette page et revenir dans le CRM (les réponses seront détectées).');
});

router.get('/gmail/status', requireAuth, requireRole(['SUPER_ADMIN']), async (req: AuthedRequest, res: Response) => {
  const env = readGoogleEnv();
  const prisma = getPrisma();
  const account = await prisma.googleGmailAccount.findFirst({
    where: { email: env.workspaceEmail, organizationId: req.auth!.organizationId }
  });
  res.json({
    connected: !!account,
    email: env.workspaceEmail,
    watchExpiration: account?.watchExpiration || null,
    lastHistoryId: account?.lastHistoryId || null
  });
});

router.post('/gmail/push', async (req: Request, res: Response) => {
  try {
    await verifyPubSubOidc({ authorization: String(req.headers.authorization || '') });
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = req.body || {};
  const msg = body?.message || {};
  const dataB64 = normalizeText(msg?.data);
  if (!dataB64) return res.status(400).json({ error: 'missing_message_data' });

  let decoded: any = null;
  try {
    decoded = JSON.parse(Buffer.from(dataB64, 'base64').toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid_message_data' });
  }

  const emailAddress = normalizeText(decoded?.emailAddress);
  const historyId = normalizeText(decoded?.historyId);
  if (!emailAddress || !historyId) return res.status(200).json({ ok: true });

  try {
    await processGmailPushNotification({ emailAddress, historyId });
  } catch (err) {
    console.error('[google][gmail] push handler error', err);
    // Still ack to avoid Pub/Sub retry storms; we'll resync manually if needed.
  }

  return res.status(200).json({ ok: true });
});

export default router;

