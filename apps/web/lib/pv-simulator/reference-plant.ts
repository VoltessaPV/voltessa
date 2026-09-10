import { prisma } from "@/lib/prisma";

/**
 * PV Simulator — reference PV plant selection.
 *
 * The simulator scales a real Voltessa PV plant's per-15-minute produced
 * energy up/down to a hypothetical capacity. The reference plant supplies
 * both the production *shape* and the reference capacity.
 *
 * Reference capacity = `Plant.capacityKw` — the canonical topology field
 * (`docs/CANONICAL_ENTITY_CONTRACT.md`), reused, never a new field or a
 * hard-coded number. Chomakovtsi (`"Чомаковци 100KW"`) is the first
 * reference plant; the picker lists every qualifying plant so more can be
 * added with no code change.
 *
 * Cross-organization by design (Platform Admin only) — the same pattern
 * `lib/admin/reporting-queries.ts` / Automation Lab / Digital Twin use.
 */

export type ReferencePlant = {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  timezone: string;
  /** `Plant.capacityKw` — kWp. Guaranteed > 0 by the query filter. */
  referenceCapacityKwp: number;
};

const QUALIFYING_WHERE = {
  vendor: "Huawei",
  plantCode: { not: null },
  capacityKw: { gt: 0 },
} as const;

const SELECT = {
  id: true,
  name: true,
  timezone: true,
  capacityKw: true,
  organizationId: true,
  organization: { select: { name: true } },
} as const;

type Row = {
  id: string;
  name: string;
  timezone: string;
  capacityKw: { toString(): string } | null;
  organizationId: string;
  organization: { name: string };
};

function toReferencePlant(row: Row): ReferencePlant {
  return {
    id: row.id,
    name: row.name,
    organizationId: row.organizationId,
    organizationName: row.organization.name,
    timezone: row.timezone,
    referenceCapacityKwp: Number(row.capacityKw?.toString() ?? "0"),
  };
}

/** Every plant that can act as a PV production reference, ordered organization → plant. */
export async function listReferencePlants(): Promise<ReferencePlant[]> {
  const rows = await prisma.plant.findMany({
    where: QUALIFYING_WHERE,
    orderBy: [{ organization: { name: "asc" } }, { name: "asc" }],
    select: SELECT,
  });
  return (rows as Row[]).map(toReferencePlant);
}

/**
 * Resolves one reference plant by id. `null` when the id is not a
 * qualifying reference plant — the caller returns the same not-found
 * response other admin surfaces use, never a hint the id was close. The
 * plant's `timezone`, `organizationId` and capacity come from this row,
 * never from the client.
 */
export async function getReferencePlant(plantId: string): Promise<ReferencePlant | null> {
  if (typeof plantId !== "string" || plantId.trim() === "") return null;
  const row = await prisma.plant.findFirst({
    where: { id: plantId, ...QUALIFYING_WHERE },
    select: SELECT,
  });
  return row ? toReferencePlant(row as Row) : null;
}
