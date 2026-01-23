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
  return res.redirect(302, url);
});

export default router;

