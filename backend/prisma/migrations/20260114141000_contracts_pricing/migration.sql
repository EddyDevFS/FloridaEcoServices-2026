-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('SENT', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "ContractFrequency" AS ENUM ('YEARLY', 'TWICE_YEAR');

-- CreateTable
CREATE TABLE "PricingDefaults" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomsMinPerSession" INTEGER NOT NULL DEFAULT 10,
    "roomsMaxPerSession" INTEGER NOT NULL DEFAULT 20,
    "basePrices" JSONB NOT NULL DEFAULT '{}',
    "penaltyPrices" JSONB NOT NULL DEFAULT '{}',
    "contractPrices" JSONB NOT NULL DEFAULT '{}',
    "advantagePrices" JSONB NOT NULL DEFAULT '{}',
    "sqftPrices" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'SENT',
    "hotelName" TEXT NOT NULL DEFAULT '',
    "contact" JSONB NOT NULL DEFAULT '{}',
    "pricing" JSONB NOT NULL DEFAULT '{}',
    "roomsMinPerSession" INTEGER NOT NULL DEFAULT 0,
    "roomsMaxPerSession" INTEGER NOT NULL DEFAULT 0,
    "roomsPerSession" INTEGER NOT NULL DEFAULT 0,
    "frequency" "ContractFrequency" NOT NULL DEFAULT 'YEARLY',
    "surfaceType" "SurfaceType" NOT NULL DEFAULT 'BOTH',
    "appliedTier" TEXT NOT NULL DEFAULT '',
    "appliedPricePerRoom" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherSurfaces" JSONB NOT NULL DEFAULT '{}',
    "totalPerSession" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedBy" TEXT NOT NULL DEFAULT '',
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingDefaults_organizationId_key" ON "PricingDefaults"("organizationId");

-- CreateIndex
CREATE INDEX "PricingDefaults_organizationId_idx" ON "PricingDefaults"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_token_key" ON "Contract"("token");

-- CreateIndex
CREATE INDEX "Contract_organizationId_idx" ON "Contract"("organizationId");

-- CreateIndex
CREATE INDEX "Contract_hotelId_idx" ON "Contract"("hotelId");

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "Contract"("status");

-- AddForeignKey
ALTER TABLE "PricingDefaults" ADD CONSTRAINT "PricingDefaults_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

