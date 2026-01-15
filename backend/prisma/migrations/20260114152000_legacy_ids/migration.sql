-- Hotels + structure
ALTER TABLE "Hotel" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "Hotel_organizationId_legacyId_key" ON "Hotel"("organizationId","legacyId");

ALTER TABLE "Building" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "Building_hotelId_legacyId_key" ON "Building"("hotelId","legacyId");

ALTER TABLE "Floor" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "Floor_buildingId_legacyId_key" ON "Floor"("buildingId","legacyId");

ALTER TABLE "Room" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "Room_floorId_legacyId_key" ON "Room"("floorId","legacyId");

ALTER TABLE "Space" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "Space_floorId_legacyId_key" ON "Space"("floorId","legacyId");

-- Planning primitives
ALTER TABLE "BlockedSlot" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "BlockedSlot_organizationId_legacyId_key" ON "BlockedSlot"("organizationId","legacyId");

ALTER TABLE "Technician" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "Technician_organizationId_legacyId_key" ON "Technician"("organizationId","legacyId");

ALTER TABLE "Session" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "Session_organizationId_legacyId_key" ON "Session"("organizationId","legacyId");

-- Tasks + staff
ALTER TABLE "Task" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "Task_organizationId_legacyId_key" ON "Task"("organizationId","legacyId");

ALTER TABLE "StaffMember" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "StaffMember_organizationId_legacyId_key" ON "StaffMember"("organizationId","legacyId");

-- Contracts
ALTER TABLE "Contract" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "Contract_organizationId_legacyId_key" ON "Contract"("organizationId","legacyId");

