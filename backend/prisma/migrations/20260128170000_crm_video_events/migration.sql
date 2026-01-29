-- CRM video view tracking (watch time / progress) tied to CRM message (mid)

CREATE TYPE "CrmVideoEventType" AS ENUM ('PAGE_VIEW', 'PLAY', 'PAUSE', 'PROGRESS', 'ENDED');

CREATE TABLE "CrmVideoEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "videoId" TEXT,
    "sessionId" TEXT NOT NULL DEFAULT '',
    "type" "CrmVideoEventType" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "currentTimeSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "percent" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "CrmVideoEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmVideoEvent_organizationId_idx" ON "CrmVideoEvent"("organizationId");
CREATE INDEX "CrmVideoEvent_messageId_idx" ON "CrmVideoEvent"("messageId");
CREATE INDEX "CrmVideoEvent_videoId_idx" ON "CrmVideoEvent"("videoId");
CREATE INDEX "CrmVideoEvent_sessionId_idx" ON "CrmVideoEvent"("sessionId");
CREATE INDEX "CrmVideoEvent_type_at_idx" ON "CrmVideoEvent"("type", "at");

ALTER TABLE "CrmVideoEvent"
ADD CONSTRAINT "CrmVideoEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrmVideoEvent"
ADD CONSTRAINT "CrmVideoEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CrmEmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrmVideoEvent"
ADD CONSTRAINT "CrmVideoEvent_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

