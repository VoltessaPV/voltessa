import { huaweiControlAdapter } from "@/lib/fusionsolar/huawei-control-adapter";
import { prisma } from "@/lib/prisma";

import type {
  AutomationPayload,
  AutomationType,
  CanonicalAutomationResult,
  ManufacturerControlAdapter,
} from "./manufacturer-control-adapter";

/**
 * Canonical Entity Contract (ADR-018). The one entry point Automation Lab
 * (and any future automation caller) uses — it never imports a vendor
 * module directly. Resolving `plantId` to a `ManufacturerControlAdapter` is
 * this module's entire job; every automation-specific behavior lives in the
 * adapter it dispatches to.
 *
 * Atlanta's Chromium automation is deliberately not, and will never be, a
 * registered adapter here — it stays fully isolated in `automation/`
 * (repo root) and `lib/automation-client.ts`, per the standing exception.
 */
const ADAPTERS: Record<string, ManufacturerControlAdapter> = {
  Huawei: huaweiControlAdapter,
};

export type AutomationExecutionResult = CanonicalAutomationResult & {
  /** `Plant.vendor` — which manufacturer this plant actually is. */
  vendor: string;
  /** The adapter that ran — today always equal to `vendor` (one adapter per vendor), kept distinct since Automation Lab displays both. */
  adapter: string;
};

export const AutomationService = {
  async execute(
    plantId: string,
    type: AutomationType,
    payload: AutomationPayload = {},
  ): Promise<AutomationExecutionResult> {
    const plant = await prisma.plant.findUnique({
      where: { id: plantId },
      select: { vendor: true },
    });

    if (!plant) {
      throw new Error("Plant not found");
    }

    const adapter = ADAPTERS[plant.vendor];

    if (!adapter) {
      throw new Error(`No ManufacturerControlAdapter registered for vendor "${plant.vendor}"`);
    }

    const result = await adapter.execute(plantId, type, payload);

    return { ...result, vendor: plant.vendor, adapter: adapter.vendor };
  },
};
