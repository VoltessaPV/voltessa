import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

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
  | "trader_profile_updated"
  | "trader_assigned"
  | "trader_changed"
  | "trader_removed";

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
 * write has already succeeded, never speculatively before one.
 */
export async function createAuditLog(input: CreateAuditLogInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId ?? null,
      organizationId: input.organizationId ?? null,
      action: input.action,
      metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
    },
  });
}
