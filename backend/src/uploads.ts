import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';

export type UploadEnv = {
  uploadsDir: string;
};

export function readUploadEnv(): UploadEnv {
  const uploadsDir = String(process.env.UPLOADS_DIR || '/app/uploads').trim();
  if (!uploadsDir) throw new Error('Missing UPLOADS_DIR');
  return { uploadsDir };
}

export function makeUploadKey(ext: string): { relativePath: string; filename: string } {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const rand = randomBytes(16).toString('hex');
  const filename = `${yyyy}${mm}${dd}-${rand}.${ext}`;
  const relativePath = path.posix.join(yyyy, mm, filename);
  return { relativePath, filename };
}

export async function writeUploadFile(uploadsDir: string, relativePath: string, bytes: Buffer) {
  const fullPath = path.join(uploadsDir, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, bytes);
  return fullPath;
}

