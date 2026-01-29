import { Router, type Request, type Response } from 'express';
import { getPrisma } from '../db';

const router = Router();

function normalizeText(v: any) {
  return String(v || '').trim();
}

function getIp(req: Request) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0]?.trim();
  return forwarded || String((req as any).ip || '');
}

function hostnameFromUrl(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function buildInternalHostAllowlist(): Set<string> {
  const out = new Set<string>();
  const add = (u: string) => {
    const host = hostnameFromUrl(String(u || '').trim());
    if (host) out.add(host);
  };

  add(String(process.env.PUBLIC_APP_URL || ''));
  add(String(process.env.PUBLIC_API_URL || ''));

  // Also accept any configured CORS origins (helps when domains differ)
  const cors = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const c of cors) add(c);

  return out;
}

const INTERNAL_HOSTS = buildInternalHostAllowlist();

function appendMidIfInternal(destination: string, messageId: string) {
  if (!destination || !messageId) return destination;
  let u: URL;
  try {
    u = new URL(destination);
  } catch {
    return destination;
  }

  const host = String(u.hostname || '').toLowerCase();
  if (!host || !INTERNAL_HOSTS.has(host)) return destination;
  if (u.searchParams.has('mid')) return destination;
  u.searchParams.set('mid', messageId);
  return u.toString();
}

const PIXEL_GIF = Buffer.from(
  // 1x1 transparent gif
  'R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64'
);

router.get('/pixel', async (req: Request, res: Response) => {
  const prisma = getPrisma();
  const messageId = normalizeText(req.query?.mid);
  if (messageId) {
    try {
      await prisma.crmEmailEvent.create({
        data: {
          messageId,
          type: 'OPENED',
          ip: getIp(req),
          userAgent: normalizeText(req.headers['user-agent'])
        }
      });
    } catch {
      // ignore: tracking must never break UX
    }
  }

  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.status(200).send(PIXEL_GIF);
});

router.get('/click', async (req: Request, res: Response) => {
  const prisma = getPrisma();
  const messageId = normalizeText(req.query?.mid);
  const urlRaw = normalizeText(req.query?.url);

  let url = '';
  try {
    url = decodeURIComponent(urlRaw);
  } catch {
    url = urlRaw;
  }

  if (messageId) {
    try {
      await prisma.crmEmailEvent.create({
        data: {
          messageId,
          type: 'CLICKED',
          url,
          ip: getIp(req),
          userAgent: normalizeText(req.headers['user-agent'])
        }
      });
    } catch {}
  }

  if (!url) return res.status(400).send('missing url');
  const redirected = messageId ? appendMidIfInternal(url, messageId) : url;
  return res.redirect(302, redirected);
});

router.post('/video', async (req: Request, res: Response) => {
  const prisma = getPrisma();
  const messageId = normalizeText(req.body?.mid);
  const sessionId = normalizeText(req.body?.sid);
  const videoId = normalizeText(req.body?.vid) || null;
  const typeRaw = normalizeText(req.body?.type).toUpperCase();
  const type =
    typeRaw === 'PAGE_VIEW' || typeRaw === 'PLAY' || typeRaw === 'PAUSE' || typeRaw === 'PROGRESS' || typeRaw === 'ENDED'
      ? (typeRaw as any)
      : null;

  const currentTimeSeconds = Number(req.body?.t ?? 0);
  const durationSeconds = Number(req.body?.d ?? 0);
  const percent = Number(req.body?.p ?? 0);

  if (!messageId || !type) return res.status(204).end();

  try {
    const msg = await prisma.crmEmailMessage.findFirst({
      where: { id: messageId },
      select: { organizationId: true }
    });
    if (!msg) return res.status(204).end();

    await prisma.crmVideoEvent.create({
      data: {
        organizationId: msg.organizationId,
        messageId,
        videoId: videoId || null,
        sessionId: sessionId || '',
        type,
        ip: getIp(req),
        userAgent: normalizeText(req.headers['user-agent']),
        currentTimeSeconds: Number.isFinite(currentTimeSeconds) ? Math.max(0, currentTimeSeconds) : 0,
        durationSeconds: Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0,
        percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0
      }
    });
  } catch {
    // ignore: tracking must never break UX
  }

  res.status(204).end();
});

export default router;
