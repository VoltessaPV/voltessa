import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/** Accepts either the module-level singleton or an interactive transaction's `tx` handle. */
type PrismaClientOrTransaction = PrismaClient | Prisma.TransactionClient;

/**
 * Platform Administration milestone's action vocabulary — a plain string in
 * the schema (see `AuditLog`'s doc comment), typed here so callers can't
 * pass an arbitrary value. Same "closed-but-growable kind vocabulary"
 * convention as `AutomationEventType`. One event per admin save, not one
 * per changed field — an email change within a `user_updated`/
 * `trader_profile_updated` save is recorded in that same event's
 * `metadata`, not as a second row.
 */
export type AdminAuditActionType =
  | "user_activated"
  | "user_deactivated"
  | "user_updated"
  | "user_deleted"
  | "user_restored"
  | "user_purged"
  | "trader_profile_updated"
  | "trader_assigned"
  | "trader_changed"
  | "trader_removed"
  | "impersonation_started"
  | "impersonation_ended";

export type CreateAuditLogInput = {
  actorUserId: string;
  targetUserId?: string | null;
  organizationId?: string | null;
  action: AdminAuditActionType;
  metadata?: Record<string, unknown> | null;
};

/**
 * Creates one Audit Log row — the Platform Administration module's first
 * real consumer of `AuditLog` (schema-only since ADR-014). Called after a
 * write has already succeeded, never speculatively before one - except
 * inside an interactive transaction (see purgeUser), where passing `tx`
 * here makes the audit row part of the same atomic unit as the write it
 * describes, so a rollback undoes both together. Defaults to the module
 * singleton for every other, non-transactional caller.
 */
export async function createAuditLog(
  input: CreateAuditLogInput,
  client: PrismaClientOrTransaction = prisma,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId ?? null,
      organizationId: input.organizationId ?? null,
      action: input.action,
      metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
    },
  });
}
