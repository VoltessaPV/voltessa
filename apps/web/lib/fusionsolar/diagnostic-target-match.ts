/**
 * Pure, dependency-free target-type matching for the Huawei Diagnostic
 * Tests framework. Deliberately has NO import of `prisma`, `api-client`, or
 * anything else server-only — this is the one piece of the framework's
 * matching logic that both the server (validating a client-supplied target
 * against a test's `supportedTargetTypes`) and the client component
 * (filtering the Target dropdown when the selected test changes) must
 * apply identically. Splitting it out here, rather than duplicating it in
 * both places or importing the server-only `diagnostic-tests.ts` into a
 * "use client" component, is what keeps the two in sync without pulling
 * Prisma into the browser bundle.
 *
 * A `supportedTargetTypes` entry is one of:
 * - `"plant"` — matches only the plant-level target.
 * - `"device"` — matches any device target, regardless of device type.
 * - a specific device type (`"inverter"`, `"meter"`, `"smart-dongle"`, or a
 *   `devTypeId-N` fallback) — matches only that exact device type.
 */

export type DiagnosticTargetMatchable = {
  kind: "plant" | "device";
  deviceType: string;
};

export function targetMatchesType(
  target: DiagnosticTargetMatchable,
  type: string,
): boolean {
  if (type === "plant") {
    return target.kind === "plant";
  }

  if (type === "device") {
    return target.kind === "device";
  }

  return target.deviceType === type;
}

export function filterTargetsByTypes<T extends DiagnosticTargetMatchable>(
  targets: T[],
  supportedTargetTypes: readonly string[],
): T[] {
  return targets.filter((target) =>
    supportedTargetTypes.some((type) => targetMatchesType(target, type)),
  );
}
