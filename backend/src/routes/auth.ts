import { Router, type Request, type Response } from 'express';
import argon2 from 'argon2';
import { getPrisma } from '../db';
import { readTokenEnv, signAccessToken, makeRefreshJti, signRefreshToken, hashRefreshTokenJti, verifyRefreshToken } from '../auth/tokens';
import { requireAuth, type AuthedRequest } from '../auth/middleware';

const router = Router();
const tokenEnv = readTokenEnv();

function cookieOptions() {
  const secure = String(process.env.COOKIE_SECURE || '').trim() === '1';
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/api/v1/auth'
  };
}

function accessCookieOptions() {
  const secure = String(process.env.COOKIE_SECURE || '').trim() === '1';
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/'
  };
}

router.post('/login', async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '').trim();
    if (!email || !password) return res.status(400).json({ error: 'missing_credentials' });

    const prisma = getPrisma();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'invalid_credentials' });

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    const accessToken = signAccessToken(tokenEnv, {
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role,
      email: user.email,
      hotelScopeId: (user as any).hotelScopeId || null
    });

    const jti = makeRefreshJti();
    const refreshJwt = signRefreshToken(tokenEnv, {
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role,
      email: user.email,
      hotelScopeId: (user as any).hotelScopeId || null,
      jti,
      typ: 'refresh'
    });

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshTokenJti(jti),
        expiresAt: new Date(Date.now() + tokenEnv.refreshTtlDays * 24 * 60 * 60 * 1000)
      }
    });

    res.cookie('refresh_token', refreshJwt, cookieOptions());
    res.cookie('access_token', accessToken, accessCookieOptions());
    res.json({ accessToken });
  } catch (err) {
    // Avoid leaking details; log server-side for diagnosis.
    console.error('[auth.login] failed:', err);
    res.status(500).json({ error: 'login_failed' });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const token = String((req as any).cookies?.refresh_token || '').trim();
    if (!token) return res.status(401).json({ error: 'missing_refresh_token' });

    let payload;
    try {
      payload = verifyRefreshToken(tokenEnv, token);
    } catch {
      return res.status(401).json({ error: 'invalid_refresh_token' });
    }

    const prisma = getPrisma();
    const tokenHash = hashRefreshTokenJti(payload.jti);
    const record = await prisma.refreshToken.findFirst({
      where: { userId: payload.userId, tokenHash, revokedAt: null, expiresAt: { gt: new Date() } }
    });
    if (!record) return res.status(401).json({ error: 'refresh_token_revoked' });

    await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });

    const userPayload = {
      userId: payload.userId,
      organizationId: payload.organizationId,
      role: payload.role,
      email: payload.email,
      hotelScopeId: (payload as any).hotelScopeId || null
    };

    const newJti = makeRefreshJti();
    const newRefreshJwt = signRefreshToken(tokenEnv, { ...userPayload, jti: newJti, typ: 'refresh' });
    await prisma.refreshToken.create({
      data: {
        userId: payload.userId,
        tokenHash: hashRefreshTokenJti(newJti),
        expiresAt: new Date(Date.now() + tokenEnv.refreshTtlDays * 24 * 60 * 60 * 1000)
      }
    });

    const accessToken = signAccessToken(tokenEnv, userPayload);

    res.cookie('refresh_token', newRefreshJwt, cookieOptions());
    res.cookie('access_token', accessToken, accessCookieOptions());
    res.json({ accessToken });
  } catch {
    res.status(500).json({ error: 'refresh_failed' });
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  const token = String((req as any).cookies?.refresh_token || '').trim();
  if (token) {
    try {
      const payload = verifyRefreshToken(tokenEnv, token);
      const prisma = getPrisma();
      const tokenHash = hashRefreshTokenJti(payload.jti);
      await prisma.refreshToken.updateMany({
        where: { userId: payload.userId, tokenHash, revokedAt: null },
        data: { revokedAt: new Date() }
      });
    } catch {
      // ignore
    }
  }
  res.clearCookie('refresh_token', cookieOptions());
  res.clearCookie('access_token', accessCookieOptions());
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req: AuthedRequest, res: Response) => {
  res.json({ user: req.auth });
});

export default router;
