-- Add body fields to inbound emails for minimal CRM inbox view
ALTER TABLE "CrmInboundEmail"
ADD COLUMN     "bodyText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bodyHtml" TEXT;

