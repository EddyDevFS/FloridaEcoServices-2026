-- Video thumbnails + link them to CRM email messages (what was sent to who)

CREATE TABLE "VideoThumbnail" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "originalName" TEXT NOT NULL DEFAULT '',
    "mime" TEXT NOT NULL DEFAULT '',
    "storagePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoThumbnail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoThumbnail_storagePath_key" ON "VideoThumbnail"("storagePath");
CREATE INDEX "VideoThumbnail_organizationId_idx" ON "VideoThumbnail"("organizationId");
CREATE INDEX "VideoThumbnail_published_idx" ON "VideoThumbnail"("published");
CREATE INDEX "VideoThumbnail_createdAt_idx" ON "VideoThumbnail"("createdAt");

ALTER TABLE "VideoThumbnail"
ADD CONSTRAINT "VideoThumbnail_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VideoThumbnail"
ADD CONSTRAINT "VideoThumbnail_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CrmEmailMessage"
ADD COLUMN "videoId" TEXT,
ADD COLUMN "thumbnailId" TEXT,
ADD COLUMN "videoLabel" TEXT NOT NULL DEFAULT '';

CREATE INDEX "CrmEmailMessage_videoId_idx" ON "CrmEmailMessage"("videoId");
CREATE INDEX "CrmEmailMessage_thumbnailId_idx" ON "CrmEmailMessage"("thumbnailId");

ALTER TABLE "CrmEmailMessage"
ADD CONSTRAINT "CrmEmailMessage_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CrmEmailMessage"
ADD CONSTRAINT "CrmEmailMessage_thumbnailId_fkey" FOREIGN KEY ("thumbnailId") REFERENCES "VideoThumbnail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

