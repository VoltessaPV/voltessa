-- CreateEnum
CREATE TYPE "public"."AccountType" AS ENUM ('PLANT_OWNER', 'ENERGY_TRADER');

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "accountType" "public"."AccountType" NOT NULL DEFAULT 'PLANT_OWNER',
ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."TraderAssignment" (
    "id" TEXT NOT NULL,
    "traderId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraderAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ImpersonationSession" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "adminSessionToken" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "adminIp" TEXT,
    "adminUserAgent" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ImpersonationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "organizationId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TraderAssignment_traderId_idx" ON "public"."TraderAssignment"("traderId");

-- CreateIndex
CREATE UNIQUE INDEX "TraderAssignment_organizationId_key" ON "public"."TraderAssignment"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ImpersonationSession_token_key" ON "public"."ImpersonationSession"("token");

-- CreateIndex
CREATE INDEX "ImpersonationSession_adminUserId_idx" ON "public"."ImpersonationSession"("adminUserId");

-- CreateIndex
CREATE INDEX "ImpersonationSession_targetUserId_idx" ON "public"."ImpersonationSession"("targetUserId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "public"."AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "public"."AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetUserId_idx" ON "public"."AuditLog"("targetUserId");

-- CreateIndex
CREATE INDEX "User_accountType_idx" ON "public"."User"("accountType");

-- CreateIndex
CREATE INDEX "User_isPlatformAdmin_idx" ON "public"."User"("isPlatformAdmin");

-- CreateIndex
CREATE INDEX "User_deactivatedAt_idx" ON "public"."User"("deactivatedAt");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "public"."User"("deletedAt");

-- AddForeignKey
ALTER TABLE "public"."TraderAssignment" ADD CONSTRAINT "TraderAssignment_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TraderAssignment" ADD CONSTRAINT "TraderAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TraderAssignment" ADD CONSTRAINT "TraderAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

