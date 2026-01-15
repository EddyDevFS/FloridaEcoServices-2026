-- Add scheduling + notes fields to match frontend localStorage shapes.
ALTER TABLE "Floor" ADD COLUMN "sortOrder" INTEGER;
ALTER TABLE "Floor" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Room" ADD COLUMN "cleaningFrequencyDays" INTEGER;
ALTER TABLE "Room" ADD COLUMN "lastCleanedAt" TIMESTAMP(3);
ALTER TABLE "Room" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Space" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'CORRIDOR';
ALTER TABLE "Space" ADD COLUMN "cleaningFrequencyDays" INTEGER;

