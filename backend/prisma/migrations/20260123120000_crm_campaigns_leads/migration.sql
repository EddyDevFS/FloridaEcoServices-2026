-- CreateEnum
CREATE TYPE "CrmCampaignStatus" AS ENUM ('DRAFT', 'READY');

-- CreateEnum
CREATE TYPE "CrmLeadArchiveReason" AS ENUM ('NO_RESPONSE_END', 'REPLIED_MANUAL', 'MANUAL_TAKEOVER');

-- CreateEnum
CREATE TYPE "CrmEmailMessageStatus" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CrmEmailEventType" AS ENUM ('SENT', 'OPENED', 'CLICKED', 'ERROR');

-- CreateTable
CREATE TABLE "CrmLead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hotelName" TEXT NOT NULL DEFAULT '',
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "email1" TEXT NOT NULL DEFAULT '',
    "email2" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "archiveReason" "CrmLeadArchiveReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCampaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "status" "CrmCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCampaignEmail" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "sendTime" TEXT NOT NULL DEFAULT '09:00',
    "delayDaysAfter" INTEGER NOT NULL DEFAULT 2,
    "subjectTemplate" TEXT NOT NULL DEFAULT '',
    "bodyTemplate" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmCampaignEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLeadCampaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "archiveReason" "CrmLeadArchiveReason",
    "lastSentStep" INTEGER NOT NULL DEFAULT 0,
    "awaitingValidation" BOOLEAN NOT NULL DEFAULT false,
    "nextSendAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLeadCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmEmailMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "leadCampaignId" TEXT NOT NULL,
    "campaignEmailId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" "CrmEmailMessageStatus" NOT NULL DEFAULT 'SCHEDULED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "lastError" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmEmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmEmailEvent" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" "CrmEmailEventType" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "CrmEmailEvent_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "leadId" TEXT;

-- CreateIndex
CREATE INDEX "CrmLead_organizationId_idx" ON "CrmLead"("organizationId");
CREATE INDEX "CrmLead_email1_idx" ON "CrmLead"("email1");
CREATE INDEX "CrmLead_hotelName_idx" ON "CrmLead"("hotelName");

CREATE INDEX "CrmCampaign_organizationId_idx" ON "CrmCampaign"("organizationId");

CREATE UNIQUE INDEX "CrmCampaignEmail_campaignId_stepIndex_key" ON "CrmCampaignEmail"("campaignId", "stepIndex");
CREATE INDEX "CrmCampaignEmail_campaignId_idx" ON "CrmCampaignEmail"("campaignId");

CREATE INDEX "CrmLeadCampaign_organizationId_idx" ON "CrmLeadCampaign"("organizationId");
CREATE INDEX "CrmLeadCampaign_leadId_idx" ON "CrmLeadCampaign"("leadId");
CREATE INDEX "CrmLeadCampaign_campaignId_idx" ON "CrmLeadCampaign"("campaignId");
CREATE INDEX "CrmLeadCampaign_archivedAt_idx" ON "CrmLeadCampaign"("archivedAt");
CREATE UNIQUE INDEX "CrmLeadCampaign_leadId_campaignId_startedAt_key" ON "CrmLeadCampaign"("leadId", "campaignId", "startedAt");

CREATE INDEX "CrmEmailMessage_organizationId_idx" ON "CrmEmailMessage"("organizationId");
CREATE INDEX "CrmEmailMessage_leadId_idx" ON "CrmEmailMessage"("leadId");
CREATE INDEX "CrmEmailMessage_leadCampaignId_idx" ON "CrmEmailMessage"("leadCampaignId");
CREATE INDEX "CrmEmailMessage_sendAt_idx" ON "CrmEmailMessage"("sendAt");
CREATE INDEX "CrmEmailMessage_status_sendAt_idx" ON "CrmEmailMessage"("status", "sendAt");
CREATE UNIQUE INDEX "CrmEmailMessage_leadCampaignId_stepIndex_key" ON "CrmEmailMessage"("leadCampaignId", "stepIndex");

CREATE INDEX "CrmEmailEvent_messageId_idx" ON "CrmEmailEvent"("messageId");
CREATE INDEX "CrmEmailEvent_type_at_idx" ON "CrmEmailEvent"("type", "at");

CREATE INDEX "Quote_leadId_idx" ON "Quote"("leadId");

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CrmCampaign" ADD CONSTRAINT "CrmCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CrmCampaignEmail" ADD CONSTRAINT "CrmCampaignEmail_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CrmCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrmLeadCampaign" ADD CONSTRAINT "CrmLeadCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmLeadCampaign" ADD CONSTRAINT "CrmLeadCampaign_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmLeadCampaign" ADD CONSTRAINT "CrmLeadCampaign_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CrmCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CrmEmailMessage" ADD CONSTRAINT "CrmEmailMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmEmailMessage" ADD CONSTRAINT "CrmEmailMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmEmailMessage" ADD CONSTRAINT "CrmEmailMessage_leadCampaignId_fkey" FOREIGN KEY ("leadCampaignId") REFERENCES "CrmLeadCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmEmailMessage" ADD CONSTRAINT "CrmEmailMessage_campaignEmailId_fkey" FOREIGN KEY ("campaignEmailId") REFERENCES "CrmCampaignEmail"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CrmEmailEvent" ADD CONSTRAINT "CrmEmailEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CrmEmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

