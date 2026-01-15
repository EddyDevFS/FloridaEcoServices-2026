-- Add optional hotel scope to users (restrict hotel accounts to one hotel).

ALTER TABLE "User" ADD COLUMN "hotelScopeId" TEXT;

CREATE INDEX "User_hotelScopeId_idx" ON "User"("hotelScopeId");

ALTER TABLE "User"
  ADD CONSTRAINT "User_hotelScopeId_fkey"
  FOREIGN KEY ("hotelScopeId") REFERENCES "Hotel"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

