-- CreateEnum
CREATE TYPE "VideoCommentKind" AS ENUM ('SEEDED', 'PUBLIC');

-- CreateTable
CREATE TABLE "VideoComment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "videoId" TEXT NOT NULL,
  "kind" "VideoCommentKind" NOT NULL DEFAULT 'PUBLIC',
  "published" BOOLEAN NOT NULL DEFAULT TRUE,
  "firstName" TEXT NOT NULL DEFAULT '',
  "lastName" TEXT NOT NULL DEFAULT '',
  "city" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "comment" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VideoComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoComment_organizationId_idx" ON "VideoComment"("organizationId");

-- CreateIndex
CREATE INDEX "VideoComment_videoId_idx" ON "VideoComment"("videoId");

-- CreateIndex
CREATE INDEX "VideoComment_kind_idx" ON "VideoComment"("kind");

-- CreateIndex
CREATE INDEX "VideoComment_published_idx" ON "VideoComment"("published");

-- CreateIndex
CREATE INDEX "VideoComment_createdAt_idx" ON "VideoComment"("createdAt");

-- AddForeignKey
ALTER TABLE "VideoComment" ADD CONSTRAINT "VideoComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoComment" ADD CONSTRAINT "VideoComment_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

