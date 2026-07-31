-- CreateTable
CREATE TABLE "public"."ConsentLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "version" INTEGER NOT NULL,
    "necessary" BOOLEAN NOT NULL DEFAULT true,
    "functional" BOOLEAN NOT NULL DEFAULT false,
    "analytics" BOOLEAN NOT NULL DEFAULT false,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "action" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AccountDeletionRecord" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'self_service',
    "actionType" TEXT NOT NULL DEFAULT 'account_deleted',
    "correlationId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDeletionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentLog_userId_createdAt_idx" ON "public"."ConsentLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountDeletionRecord_correlationId_key" ON "public"."AccountDeletionRecord"("correlationId");

-- AddForeignKey
ALTER TABLE "public"."ConsentLog" ADD CONSTRAINT "ConsentLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
