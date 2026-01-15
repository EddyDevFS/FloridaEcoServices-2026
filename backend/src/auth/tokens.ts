import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import { type Role } from '@prisma/client';

export type JwtUser = {
  userId: string;
  organizationId: string;
  role: Role;
  email: string;
  hotelScopeId?: string | null;
};

export type TokenEnv = {
  accessSecret: string;
  refreshSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
};

export function readTokenEnv(): TokenEnv {
  const accessSecret = String(process.env.JWT_ACCESS_SECRET || '').trim();
  const refreshSecret = String(process.env.JWT_REFRESH_SECRET || '').trim();
  if (!accessSecret) throw new Error('Missing JWT_ACCESS_SECRET');
  if (!refreshSecret) throw new Error('Missing JWT_REFRESH_SECRET');

  const accessTtlSeconds = Number(process.env.JWT_ACCESS_TTL_SECONDS || 900);
  const refreshTtlDays = Number(process.env.JWT_REFRESH_TTL_DAYS || 14);
  if (!Number.isFinite(accessTtlSeconds) || accessTtlSeconds < 60) throw new Error('Invalid JWT_ACCESS_TTL_SECONDS');
  if (!Number.isFinite(refreshTtlDays) || refreshTtlDays < 1) throw new Error('Invalid JWT_REFRESH_TTL_DAYS');

  return { accessSecret, refreshSecret, accessTtlSeconds, refreshTtlDays };
}

export function signAccessToken(env: TokenEnv, payload: JwtUser): string {
  return jwt.sign(payload, env.accessSecret, { expiresIn: env.accessTtlSeconds });
}

export type RefreshJwt = JwtUser & { jti: string; typ: 'refresh' };

export function makeRefreshJti(): string {
  return randomBytes(24).toString('hex');
}

export function hashRefreshTokenJti(jti: string): string {
  return createHash('sha256').update(jti).digest('hex');
}

export function signRefreshToken(env: TokenEnv, payload: RefreshJwt): string {
  return jwt.sign(payload, env.refreshSecret, { expiresIn: `${env.refreshTtlDays}d` });
}

export function verifyRefreshToken(env: TokenEnv, token: string): RefreshJwt {
  const decoded = jwt.verify(token, env.refreshSecret);
  if (typeof decoded !== 'object' || decoded === null) throw new Error('Invalid refresh token');
  const typ = (decoded as any).typ;
  const jti = (decoded as any).jti;
  if (typ !== 'refresh' || typeof jti !== 'string' || !jti) throw new Error('Invalid refresh token');
  return decoded as RefreshJwt;
}

export function verifyAccessToken(env: TokenEnv, token: string): JwtUser {
  const decoded = jwt.verify(token, env.accessSecret);
  if (typeof decoded !== 'object' || decoded === null) throw new Error('Invalid access token');
  return decoded as JwtUser;
}
