import argon2 from 'argon2';
import { getPrisma } from '../db';

type SeedEnv = {
  adminEmail: string;
  adminPassword: string;
  organizationName: string;
  resetPassword: boolean;
};

function canonicalEmail(input: string): string {
  // Handles copy/paste issues like: « eddy@floridaecoservices.com » (NBSP + guillemets)
  let s = String(input || '');
  s = s.replace(/\u00a0/g, ' '); // NBSP -> space
  s = s.trim();
  // Strip common surrounding quotes/brackets repeatedly
  const stripRe = /^[\s"'“”‘’«»‹›()[\]{}]+|[\s"'“”‘’«»‹›()[\]{}]+$/g;
  // Apply a few times to handle nested wrapping
  for (let i = 0; i < 3; i++) s = s.replace(stripRe, '').trim();
  return s.toLowerCase();
}

function readSeedEnv(): SeedEnv {
  const adminEmail = canonicalEmail(process.env.ADMIN_EMAIL || '');
  const adminPassword = String(process.env.ADMIN_PASSWORD || '').trim();
  const organizationName = String(process.env.ORG_NAME || 'Florida Eco Services').trim();
  const resetPassword = String(process.env.ADMIN_RESET_PASSWORD || '').trim() === '1';

  if (!adminEmail) throw new Error('Missing ADMIN_EMAIL');
  if (!adminPassword || adminPassword.length < 12) {
    throw new Error('Missing/weak ADMIN_PASSWORD (min 12 chars)');
  }
  if (!organizationName) throw new Error('Missing ORG_NAME');

  return { adminEmail, adminPassword, organizationName, resetPassword };
}

async function main() {
  const env = readSeedEnv();
  const prisma = getPrisma();

  const organization =
    (await prisma.organization.findFirst({ where: { name: env.organizationName } })) ||
    (await prisma.organization.create({ data: { name: env.organizationName } }));

  let existingUser = await prisma.user.findUnique({ where: { email: env.adminEmail } });

  if (!existingUser) {
    const candidates = await prisma.user.findMany({
      where: { organizationId: organization.id },
      select: { id: true, email: true, organizationId: true }
    });
    const matches = candidates.filter((u) => canonicalEmail(u.email) === env.adminEmail);
    if (matches.length > 1) {
      throw new Error(`Multiple users match this email after normalization: ${env.adminEmail}`);
    }
    if (matches.length === 1) {
      existingUser = await prisma.user.update({
        where: { id: matches[0].id },
        data: { email: env.adminEmail }
      });
      // eslint-disable-next-line no-console
      console.log(`[seed] fixed stored email to: ${env.adminEmail}`);
    }
  }

  if (existingUser) {
    if (existingUser.organizationId !== organization.id) {
      throw new Error(`User ${env.adminEmail} already exists in another organization`);
    }
    if (!env.resetPassword) {
      // eslint-disable-next-line no-console
      console.log(`[seed] admin already exists: ${env.adminEmail}`);
      // eslint-disable-next-line no-console
      console.log('[seed] tip: set ADMIN_RESET_PASSWORD=1 to rotate password');
      return;
    }

    const passwordHash = await argon2.hash(env.adminPassword);
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { passwordHash }
    });
    // eslint-disable-next-line no-console
    console.log(`[seed] rotated password for: ${env.adminEmail}`);
    return;
  }

  const passwordHash = await argon2.hash(env.adminPassword);

  await prisma.user.create({
    data: {
      email: env.adminEmail,
      passwordHash,
      role: 'SUPER_ADMIN',
      organizationId: organization.id
    }
  });

  // eslint-disable-next-line no-console
  console.log(`[seed] created SUPER_ADMIN: ${env.adminEmail} (org: ${organization.name})`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await getPrisma().$disconnect();
    } catch {
      // ignore
    }
  });
