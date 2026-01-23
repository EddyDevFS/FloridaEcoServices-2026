-- AddEnumValue (safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CrmLeadArchiveReason'
      AND e.enumlabel = 'REPLIED_AUTO'
  ) THEN
    EXECUTE 'ALTER TYPE "CrmLeadArchiveReason" ADD VALUE ''REPLIED_AUTO''';
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "GoogleGmailAccount" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "refreshToken" TEXT NOT NULL,
  "lastHistoryId" TEXT,
  "watchExpiration" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GoogleGmailAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GoogleGmailAccount_email_key" ON "GoogleGmailAccount"("email");
CREATE INDEX IF NOT EXISTS "GoogleGmailAccount_organizationId_idx" ON "GoogleGmailAccount"("organizationId");

ALTER TABLE "GoogleGmailAccount"
  ADD CONSTRAINT "GoogleGmailAccount_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE IF NOT EXISTS "CrmInboundEmail" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "leadId" TEXT,
  "leadCampaignId" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'gmail',
  "providerMessageId" TEXT NOT NULL,
  "threadId" TEXT,
  "fromEmail" TEXT NOT NULL DEFAULT '',
  "toEmail" TEXT NOT NULL DEFAULT '',
  "subject" TEXT NOT NULL DEFAULT '',
  "snippet" TEXT NOT NULL DEFAULT '',
  "receivedAt" TIMESTAMP(3),
  "rawHeaders" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CrmInboundEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CrmInboundEmail_provider_providerMessageId_key"
  ON "CrmInboundEmail"("provider", "providerMessageId");
CREATE INDEX IF NOT EXISTS "CrmInboundEmail_organizationId_idx" ON "CrmInboundEmail"("organizationId");
CREATE INDEX IF NOT EXISTS "CrmInboundEmail_leadId_idx" ON "CrmInboundEmail"("leadId");
CREATE INDEX IF NOT EXISTS "CrmInboundEmail_leadCampaignId_idx" ON "CrmInboundEmail"("leadCampaignId");

ALTER TABLE "CrmInboundEmail"
  ADD CONSTRAINT "CrmInboundEmail_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrmInboundEmail"
  ADD CONSTRAINT "CrmInboundEmail_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CrmInboundEmail"
  ADD CONSTRAINT "CrmInboundEmail_leadCampaignId_fkey"
  FOREIGN KEY ("leadCampaignId") REFERENCES "CrmLeadCampaign"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Index
CREATE INDEX IF NOT EXISTS "CrmEmailMessage_providerMessageId_idx" ON "CrmEmailMessage"("providerMessageId");

