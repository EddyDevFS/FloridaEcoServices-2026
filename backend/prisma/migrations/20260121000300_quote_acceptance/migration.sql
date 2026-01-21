-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "token" TEXT;
ALTER TABLE "Quote" ADD COLUMN     "acceptedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN     "acceptedPlanKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quote" ADD COLUMN     "signedByName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quote" ADD COLUMN     "signedByTitle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quote" ADD COLUMN     "signedByEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quote" ADD COLUMN     "signedByIp" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quote" ADD COLUMN     "signedByUserAgent" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "Quote_token_key" ON "Quote"("token");

