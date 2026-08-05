/**
 * Canonical Entity Contract (ADR-018, `docs/CANONICAL_ENTITY_CONTRACT.md`).
 * `AutomationService` depends only on this interface, never on a concrete
 * vendor — the Huawei adapter (`lib/fusionsolar/huawei-control-adapter.ts`)
 * is the first implementation, not the only one. Zero imports of anything
 * Huawei-specific belong in this file, ever.
 */

/**
 * The five automations Automation Lab exposes today. Every future
 * automation this framework grows plugs into this same union and the same
 * `ManufacturerControlAdapter.execute` signature — never a new, parallel
 * dispatch mechanism.
 */
export type AutomationType =
  | "read-inverter-status"
  | "read-export-config"
  | "zero-export"
  | "remove-export-limit"
  | "set-export-limit";

/** Raw form-style values (matches how Automation Lab's UI collects them) — each adapter parses whatever its own automation types need. */
export type AutomationPayload = Record<string, string>;

/**
 * What every adapter call returns, regardless of vendor — the exact fields
 * Automation Lab displays: request/response JSON verbatim, timing, HTTP
 * status, vendor status, and any errors/warnings. `vendorStatusCode` is
 * whatever status concept the vendor's own API uses (Huawei's `failCode`);
 * generalized here so a future vendor's equivalent field slots into the
 * same name.
 */
export type CanonicalAutomationResult = {
  requestBody: unknown;
  responseBody: unknown;
  durationMs: number;
  httpStatus: number | null;
  vendorStatusCode: number | null;
  success: boolean | null;
  errors: string[];
  warnings: string[];
};

export interface ManufacturerControlAdapter {
  /** Matches `Plant.vendor` exactly (e.g. `"Huawei"`) — how `AutomationService` looks up which adapter to use. */
  vendor: string;
  execute(
    plantId: string,
    type: AutomationType,
    payload: AutomationPayload,
  ): Promise<CanonicalAutomationResult>;
}
