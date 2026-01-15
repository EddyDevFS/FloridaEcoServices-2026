-- Persist user's last selected hotel (prevents activeHotelId resetting on API pull).
ALTER TABLE "User" ADD COLUMN "activeHotelId" TEXT;

ALTER TABLE "User"
  ADD CONSTRAINT "User_activeHotelId_fkey"
  FOREIGN KEY ("activeHotelId") REFERENCES "Hotel"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

