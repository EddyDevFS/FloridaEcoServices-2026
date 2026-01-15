export type Env = {
  port: number;
  databaseUrl: string;
  corsOrigin: string;
};

export function readEnv(): Env {
  const port = Number(process.env.PORT || 3001);
  if (!Number.isFinite(port) || port <= 0) throw new Error('Invalid PORT');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Missing DATABASE_URL');

  // Comma-separated list supported (e.g. "http://localhost:8000,http://127.0.0.1:8000")
  const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:8000,http://127.0.0.1:8000';

  return { port, databaseUrl, corsOrigin };
}
