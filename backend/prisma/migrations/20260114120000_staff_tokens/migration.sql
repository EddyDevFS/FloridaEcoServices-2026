-- Add staff token for staff portal links (matches shared/db.js "stafftok" usage)
-- This migration is written manually to avoid interactive prompts in CI/non-tty environments.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "StaffMember" ADD COLUMN "token" TEXT;

UPDATE "StaffMember"
SET "token" = encode(gen_random_bytes(16), 'hex')
WHERE "token" IS NULL;

ALTER TABLE "StaffMember" ALTER COLUMN "token" SET NOT NULL;

CREATE UNIQUE INDEX "StaffMember_token_key" ON "StaffMember"("token");

