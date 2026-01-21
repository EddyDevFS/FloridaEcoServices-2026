-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Quote_deletedAt_idx" ON "Quote"("deletedAt");

