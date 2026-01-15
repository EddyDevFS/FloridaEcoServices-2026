import express, { type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { readEnv } from './env';
import { getPrisma } from './db';
import authRoutes from './routes/auth';
import hotelRoutes from './routes/hotels';
import structureRoutes from './routes/structure';
import taskRoutes from './routes/tasks';
import taskAttachmentRoutes from './routes/taskAttachments';
import staffRoutes from './routes/staff';
import planningRoutes from './routes/planning';
import contractRoutes from './routes/contracts';
import incidentRoutes from './routes/incidents';
import migrationRoutes from './routes/migration';
import userRoutes from './routes/users';
import reportRoutes from './routes/reports';
import videoRoutes from './routes/videos';

const env = readEnv();
const app = express();

function parseAllowedOrigins(raw: string): string[] {
  return String(raw || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins(env.corsOrigin);
const allowAllOrigins = allowedOrigins.includes('*');

app.use(
  cors({
    origin: (origin, cb) => {
      // Non-browser clients (curl, server-to-server) don't send Origin.
      if (!origin) return cb(null, true);
      if (allowAllOrigins) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);

      // Dev-friendly: allow localhost/127.0.0.1 on any port if NODE_ENV != production.
      if (process.env.NODE_ENV !== 'production') {
        try {
          const u = new URL(origin);
          if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
            return cb(null, true);
          }
        } catch {}
      }

      return cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/health', async (_req: Request, res: Response) => {
  try {
    const prisma = getPrisma();
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true });
  } catch (err) {
    res.status(503).json({ ok: false, db: false });
  }
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/hotels', hotelRoutes);
app.use('/api/v1', structureRoutes);
app.use('/api/v1', taskRoutes);
app.use('/api/v1', taskAttachmentRoutes);
app.use('/api/v1', staffRoutes);
app.use('/api/v1', planningRoutes);
app.use('/api/v1', contractRoutes);
app.use('/api/v1', incidentRoutes);
app.use('/api/v1', migrationRoutes);
app.use('/api/v1', userRoutes);
app.use('/api/v1', reportRoutes);
app.use('/api/v1', videoRoutes);

// Final error handler (ensures JSON for API clients)
app.use((err: any, req: Request, res: Response, next: any) => {
  if (res.headersSent) return next(err);
  console.error('[api] unhandled error:', err);
  if (String(err?.message || '') === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'cors_not_allowed' });
  }
  // Express JSON parse errors are typically 400.
  const status = err?.type === 'entity.parse.failed' ? 400 : 500;
  res.status(status).json({ error: status === 400 ? 'bad_request' : 'internal_server_error' });
});

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${env.port}`);
});
