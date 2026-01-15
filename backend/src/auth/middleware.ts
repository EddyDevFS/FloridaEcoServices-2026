import { type NextFunction, type Request, type Response } from 'express';
import { readTokenEnv, verifyAccessToken, type JwtUser } from './tokens';

declare global {
  // eslint-disable-next-line no-var
  var __authEnv: ReturnType<typeof readTokenEnv> | undefined;
}

function getEnv() {
  if (!globalThis.__authEnv) globalThis.__authEnv = readTokenEnv();
  return globalThis.__authEnv;
}

export type AuthedRequest = Request & { auth?: JwtUser };

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const header = String(req.headers.authorization || '');
    const headerToken = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const cookieToken = String((req as any).cookies?.access_token || '').trim();
    const token = headerToken || cookieToken;
    if (!token) return res.status(401).json({ error: 'missing_access_token' });

    const user = verifyAccessToken(getEnv(), token);
    req.auth = user;
    next();
  } catch {
    res.status(401).json({ error: 'invalid_access_token' });
  }
}
