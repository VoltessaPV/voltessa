-- CreateTable
-- Atlanta Automation incident remediation ("reconciliation retry" change):
-- per-Europe/Sofia-date retry state for the Atlanta morning reconciliation,
-- so the daily-reconciliation route can be invoked several times each
-- morning (06:00/06:15/06:30/06:45/07:00 Sofia) idempotently, stop once an
-- attempt has verified the real FusionSolar state, and send exactly one
-- "could not be completed" notification if the final attempt still failed.
-- Purely additive: a new table, no change to any existing table.
CREATE TABLE "public"."AutomationReconciliationAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reconciliationDate" TIMESTAMP(3) NOT NULL,
    "completedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastDispatchedSlot" INTEGER NOT NULL DEFAULT -1,
    "lastAttemptAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "succeededAt" TIMESTAMP(3),
    "finalFailureNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationReconciliationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationReconciliationAttempt_organizationId_reconciliati_idx" ON "public"."AutomationReconciliationAttempt"("organizationId", "reconciliationDate");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationReconciliationAttempt_organizationId_reconciliati_key" ON "public"."AutomationReconciliationAttempt"("organizationId", "reconciliationDate");

-- AddForeignKey
ALTER TABLE "public"."AutomationReconciliationAttempt" ADD CONSTRAINT "AutomationReconciliationAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
