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
