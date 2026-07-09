-- CreateTable
CREATE TABLE "public"."PlantTelemetrySnapshot" (
    "id" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "totalIncome" DECIMAL(18,4),
    "totalPower" DECIMAL(18,4),
    "dayOnGridEnergy" DECIMAL(18,4),
    "dayPower" DECIMAL(18,4),
    "dayUseEnergy" DECIMAL(18,4),
    "dayIncome" DECIMAL(18,4),
    "realHealthState" INTEGER,
    "monthPower" DECIMAL(18,4),
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlantTelemetrySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlantTelemetrySnapshot_plantId_collectedAt_idx" ON "public"."PlantTelemetrySnapshot"("plantId", "collectedAt");

-- AddForeignKey
ALTER TABLE "public"."PlantTelemetrySnapshot" ADD CONSTRAINT "PlantTelemetrySnapshot_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "public"."Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
