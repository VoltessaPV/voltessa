/**
 * Configuration for the automation export-price threshold. A small,
 * dedicated config object rather than a bare number so it can grow to
 * include trader/trader-identifier fields in a future milestone without
 * redesigning every call site that currently reads a plain threshold
 * value. Business logic (`app/(platform)/settings/actions.ts`, the
 * Dashboard) reads this default instead of hardcoding "15"/"15.00"
 * itself.
 *
 * `AutomationSettings.energyTrader` (prisma/schema.prisma) already exists
 * as the placeholder for the "electricity trader" field this config is
 * meant to grow alongside; implementing trader configuration itself is
 * explicit future work, not done here.
 */
export type ExportThresholdConfig = {
  minimumExportPrice: number;
  currency: string;
};

export const DEFAULT_EXPORT_THRESHOLD_CONFIG: ExportThresholdConfig = {
  minimumExportPrice: 15,
  currency: "EUR",
};

/**
 * Resolves the effective export threshold for an organization: its own
 * configured `AutomationSettings` row if one exists, otherwise the
 * platform default above. Shared by the Dashboard and Market pages so
 * there is exactly one place this fallback rule is expressed.
 */
export function resolveExportThreshold(
  automationSettings: {
    minimumExportPrice: { toString(): string };
    currency: string;
  } | null,
): ExportThresholdConfig {
  if (!automationSettings) {
    return DEFAULT_EXPORT_THRESHOLD_CONFIG;
  }

  return {
    minimumExportPrice: Number(automationSettings.minimumExportPrice.toString()),
    currency: automationSettings.currency,
  };
}
