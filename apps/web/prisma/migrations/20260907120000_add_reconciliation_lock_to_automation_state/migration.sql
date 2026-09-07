-- AlterTable
-- Atlanta Automation incident remediation (PR1): give daily reconciliation its
-- own lock so a stuck 15-minute execution lock (isRunning) can no longer
-- suppress it. Purely additive: two columns with safe defaults, no data
-- rewrite, no backfill, no destructive change. Every existing AutomationState
-- row gets reconciliationRunning = false and reconciliationLockedAt = NULL.
ALTER TABLE "public"."AutomationState" ADD COLUMN     "reconciliationLockedAt" TIMESTAMP(3),
ADD COLUMN     "reconciliationRunning" BOOLEAN NOT NULL DEFAULT false;
