import {
  type BatteryConfig,
  type BatteryDispatchInterval,
  computeDegradationCostPerKwh,
  DEFAULT_BATTERY_CAPEX_EUR_PER_KWH,
  DEFAULT_BATTERY_LIFETIME_EFC,
} from "@/lib/digital-twin/battery-dispatch";
import {
  buildIntervalDiagnostics,
  type ConstraintViolation,
  type EnergyBalanceViolation,
  validateConstraints,
  validateEnergyBalance,
} from "@/lib/digital-twin/battery-diagnostics";
import { runOptimalityCheck, SYNTHETIC_OPTIMALITY_TEST_CASES, type OptimalityCheckResult } from "@/lib/digital-twin/battery-optimality-check";
import { fetchPriceSeries, replay, type ReplayOutcome } from "@/lib/digital-twin/replay-engine";
import { prisma } from "@/lib/prisma";

/**
 * Battery Engine Diagnostics milestone - reference scenarios + the overall
 * report. Deliberately isolated from the UI: this whole module is safe to
 * call from a script or a future admin diagnostic page, never from a
 * component. Real plant IDs are always supplied by the caller, never
 * hardcoded here, so this stays reusable across environments/databases.
 */

export type ReferenceScenarioDefinition = {
  name: string;
  plantId: string;
  newCapacityKw: number;
  /** `null` = no-battery baseline (Scenario 1), run through the existing, unmodified `replayCapacityScenario`. */
  battery: BatteryConfig | null;
  start: Date;
  end: Date;
};

export type ReferenceScenarioResult = {
  name: string;
  topology: string;
  totalRevenueEur: number | null;
  exportedKwh: number;
  importedKwh: number;
  chargeKwh: number;
  dischargeKwh: number;
  batteryThroughputKwh: number;
  roundTripLossesKwh: number;
  energyBalanceViolationCount: number;
  constraintViolationCount: number;
  sampleViolations: Array<EnergyBalanceViolation | ConstraintViolation>;
  /**
   * Battery Degradation Economics milestone. The DP's own internal
   * `Σ price × gridExchange / 1000` objective component (export revenue AND
   * avoided-import value together - see battery-dispatch.ts's module doc
   * comment) - deliberately a DIFFERENT figure from `totalRevenueEur` above
   * (which stays export-only, unchanged, per the existing Revenue Engine
   * contract). `null` for the no-battery baseline, where this concept
   * doesn't apply.
   */
  marketValueEur: number | null;
  /** `degradationCostPerKwh * batteryThroughputKwh` - an estimate only, never subtracted from `totalRevenueEur` or `marketValueEur`. 0 for the no-battery baseline. */
  batteryWearCostEur: number;
  /** `marketValueEur - batteryWearCostEur` - the value the optimizer actually maximizes, never itself reported as "Revenue". `null` for the no-battery baseline. */
  optimizationValueEur: number | null;
};

/**
 * Adapts the orchestrator's unified per-interval shape back into
 * `BatteryDispatchInterval[]` for `battery-diagnostics.ts`, which is only
 * ever meaningful when a battery scenario actually ran (every field here is
 * guaranteed non-null in that case - see `replay-engine.ts`'s
 * `replayWithBattery`). `availablePvKwh` maps from `productionKwh` (the
 * post-capacity-scaling value `runBatteryDispatch` itself dispatches
 * against), not the unified outcome's own pre-scaling `availablePvKwh`.
 *
 * Exported (Battery Digital Twin UI milestone) so the Digital Twin's own
 * Server Action (`app/admin/digital-twin/actions.ts`) can feed the same
 * already-computed simulation outcome into `buildIntervalDiagnostics` for
 * its "Show Battery Diagnostics" toggle, instead of a second copy of this
 * adapter - server-side reuse, not a UI/component import.
 */
export function toBatteryDispatchIntervals(intervals: ReplayOutcome["intervals"]): BatteryDispatchInterval[] {
  return intervals.map((i) => ({
    intervalStart: i.intervalStart,
    availablePvKwh: i.productionKwh!,
    consumptionKwh: i.consumptionKwh!,
    chargeKwh: i.chargeKwh!,
    dischargeKwh: i.dischargeKwh!,
    exportedKwh: i.exportedKwh!,
    importedKwh: i.importedKwh!,
    mandatoryChargeKwh: i.mandatoryChargeKwh!,
    curtailedKwh: i.curtailedKwh!,
    socKwh: i.socKwh!,
  }));
}

async function runReferenceScenario(definition: ReferenceScenarioDefinition): Promise<ReferenceScenarioResult> {
  const outcome = await replay({
    plantId: definition.plantId,
    start: definition.start,
    end: definition.end,
    scenario: {
      capacityScenario: { newCapacityKw: definition.newCapacityKw },
      batteryScenario: definition.battery ?? undefined,
    },
  });

  if (outcome.battery === null) {
    return {
      name: definition.name,
      topology: outcome.topology,
      totalRevenueEur: outcome.revenue.available ? outcome.revenue.revenueEur : null,
      exportedKwh: outcome.totals.exportedKwh,
      importedKwh: outcome.totals.importedKwh,
      chargeKwh: 0,
      dischargeKwh: 0,
      batteryThroughputKwh: 0,
      roundTripLossesKwh: 0,
      energyBalanceViolationCount: 0,
      constraintViolationCount: 0,
      sampleViolations: [],
      marketValueEur: null,
      batteryWearCostEur: 0,
      optimizationValueEur: null,
    };
  }

  const battery = definition.battery!;
  const priceSeries = await fetchPriceSeries(definition.start, definition.end);
  const dispatchIntervals = toBatteryDispatchIntervals(outcome.intervals);

  const diagnostics = buildIntervalDiagnostics(dispatchIntervals, priceSeries, battery);
  const balanceViolations = validateEnergyBalance(diagnostics, battery);
  const constraintViolations = validateConstraints(diagnostics, battery);

  const eta = Math.sqrt(battery.roundTripEfficiencyPercent / 100);
  const roundTripLossesKwh =
    Math.round(
      diagnostics.reduce((sum, d) => sum + d.batteryChargeKwh * (1 - eta) + d.batteryDischargeKwh * (1 / eta - 1), 0) * 100,
    ) / 100;

  const priceByTime = new Map(priceSeries.map((p) => [p.timestamp.getTime(), p.price]));
  const marketValueEur =
    Math.round(
      dispatchIntervals.reduce((sum, d) => {
        const price = priceByTime.get(d.intervalStart.getTime()) ?? 0;
        return sum + (price * (d.exportedKwh - d.importedKwh)) / 1000;
      }, 0) * 100,
    ) / 100;
  const batteryWearCostEur = Math.round(battery.degradationCostPerKwh * outcome.battery.throughputKwh * 100) / 100;

  return {
    name: definition.name,
    topology: outcome.topology,
    totalRevenueEur: outcome.revenue.available ? outcome.revenue.revenueEur : null,
    exportedKwh: outcome.totals.exportedKwh,
    importedKwh: outcome.totals.importedKwh,
    chargeKwh: outcome.battery.chargedEnergyKwh,
    dischargeKwh: outcome.battery.dischargedEnergyKwh,
    batteryThroughputKwh: outcome.battery.throughputKwh,
    roundTripLossesKwh,
    energyBalanceViolationCount: balanceViolations.length,
    constraintViolationCount: constraintViolations.length,
    sampleViolations: [...balanceViolations.slice(0, 3), ...constraintViolations.slice(0, 3)],
    marketValueEur,
    batteryWearCostEur,
    optimizationValueEur: Math.round((marketValueEur - batteryWearCostEur) * 100) / 100,
  };
}

export type BatteryEngineReport = {
  generatedAt: Date;
  rangeStart: Date;
  rangeEnd: Date;
  optimalityChecks: OptimalityCheckResult[];
  optimalityAllPass: boolean;
  referenceScenarios: ReferenceScenarioResult[];
  referenceScenariosAllPass: boolean;
  overallPass: boolean;
};

/** Exported (ENTSO-E Price Visualization milestone) so the forward-looking price overview can build the same default battery shape as these reference scenarios, rather than a second literal. */
export function buildDefaultBatteryConfig(plantCapacityKw: number, durationHours: number, allowGridCharging: boolean): BatteryConfig {
  const minSocPercent = 10;
  const maxSocPercent = 100;
  return {
    capacityKwh: plantCapacityKw * durationHours,
    roundTripEfficiencyPercent: 95.4,
    minSocPercent,
    maxSocPercent,
    maxChargePowerKw: plantCapacityKw,
    maxDischargePowerKw: plantCapacityKw,
    allowGridCharging,
    // Battery Degradation Economics milestone - standard LiFePO4 grid-scale
    // BESS assumptions (EUR200/kWh CAPEX, 6000 EFC), independent of battery
    // size by construction - see computeDegradationCostPerKwh.
    degradationCostPerKwh: computeDegradationCostPerKwh(
      DEFAULT_BATTERY_CAPEX_EUR_PER_KWH,
      DEFAULT_BATTERY_LIFETIME_EFC,
      maxSocPercent - minSocPercent,
    ),
  };
}

/**
 * Runs the full diagnostic suite: the seven reference scenarios (against
 * real plant data supplied by the caller) plus the independent brute-force
 * optimality cross-check (against small synthetic scenarios, never real
 * data - see `battery-optimality-check.ts`). Nothing here mutates
 * anything; this is read-only against the database and pure everywhere
 * else.
 */
export async function generateBatteryEngineReport(params: {
  /** A plant with a meter (e.g. Atlanta). */
  prosumerPlantId: string;
  /** A plant without a meter (e.g. Chomakovtsi). */
  producerPlantId: string;
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<BatteryEngineReport> {
  const { prosumerPlantId, producerPlantId, rangeStart, rangeEnd } = params;

  const [prosumerPlant, producerPlant] = await Promise.all([
    prisma.plant.findUnique({ where: { id: prosumerPlantId }, select: { capacityKw: true } }),
    prisma.plant.findUnique({ where: { id: producerPlantId }, select: { capacityKw: true } }),
  ]);

  const prosumerCapacityKw = prosumerPlant?.capacityKw ? Number(prosumerPlant.capacityKw) : null;
  const producerCapacityKw = producerPlant?.capacityKw ? Number(producerPlant.capacityKw) : null;
  if (!prosumerCapacityKw || !producerCapacityKw) {
    throw new Error("Reference plants must both have a configured installed capacity");
  }

  const scenarioDefinitions: ReferenceScenarioDefinition[] = [
    {
      name: "1. Producer, no battery",
      plantId: producerPlantId,
      newCapacityKw: producerCapacityKw,
      battery: null,
      start: rangeStart,
      end: rangeEnd,
    },
    {
      name: "2. Producer, 2-hour battery",
      plantId: producerPlantId,
      newCapacityKw: producerCapacityKw,
      battery: buildDefaultBatteryConfig(producerCapacityKw, 2, false),
      start: rangeStart,
      end: rangeEnd,
    },
    {
      name: "3. Prosumer, 2-hour battery",
      plantId: prosumerPlantId,
      newCapacityKw: prosumerCapacityKw,
      battery: buildDefaultBatteryConfig(prosumerCapacityKw, 2, false),
      start: rangeStart,
      end: rangeEnd,
    },
    {
      name: "4. Prosumer, grid charging disabled",
      plantId: prosumerPlantId,
      newCapacityKw: prosumerCapacityKw,
      battery: buildDefaultBatteryConfig(prosumerCapacityKw, 2, false),
      start: rangeStart,
      end: rangeEnd,
    },
    {
      name: "5. Prosumer, grid charging enabled",
      plantId: prosumerPlantId,
      newCapacityKw: prosumerCapacityKw,
      battery: buildDefaultBatteryConfig(prosumerCapacityKw, 2, true),
      start: rangeStart,
      end: rangeEnd,
    },
    {
      name: "6. Battery much larger than PV (20-hour)",
      plantId: prosumerPlantId,
      newCapacityKw: prosumerCapacityKw,
      battery: buildDefaultBatteryConfig(prosumerCapacityKw, 20, false),
      start: rangeStart,
      end: rangeEnd,
    },
    {
      name: "7. Very small battery (0.1-hour)",
      plantId: producerPlantId,
      newCapacityKw: producerCapacityKw,
      battery: buildDefaultBatteryConfig(producerCapacityKw, 0.1, false),
      start: rangeStart,
      end: rangeEnd,
    },
  ];

  const optimalityChecks = SYNTHETIC_OPTIMALITY_TEST_CASES.map(runOptimalityCheck);
  const referenceScenarios = await Promise.all(scenarioDefinitions.map(runReferenceScenario));

  const referenceScenariosAllPass = referenceScenarios.every(
    (s) => s.energyBalanceViolationCount === 0 && s.constraintViolationCount === 0,
  );
  const optimalityAllPass = optimalityChecks.every((c) => c.matches);

  return {
    generatedAt: new Date(),
    rangeStart,
    rangeEnd,
    optimalityChecks,
    optimalityAllPass,
    referenceScenarios,
    referenceScenariosAllPass,
    overallPass: optimalityAllPass && referenceScenariosAllPass,
  };
}

/** A concise, human-readable rendering of the report - for a console/script, not a UI component. */
export function formatBatteryEngineReport(report: BatteryEngineReport): string {
  const lines: string[] = [];

  lines.push("=".repeat(72));
  lines.push("BATTERY DISPATCH ENGINE - DIAGNOSTIC REPORT");
  lines.push(`Generated: ${report.generatedAt.toISOString()}`);
  lines.push(`Reference period: ${report.rangeStart.toISOString()} - ${report.rangeEnd.toISOString()}`);
  lines.push("=".repeat(72));

  lines.push("");
  lines.push(`OPTIMALITY VALIDATION (independent brute-force cross-check): ${report.optimalityAllPass ? "PASS" : "FAIL"}`);
  for (const check of report.optimalityChecks) {
    lines.push(
      `  [${check.matches ? "PASS" : "FAIL"}] ${check.name} - engine=${check.engineTotalValueEur} EUR, reference=${check.referenceOptimalValueEur} EUR, discrepancy=${check.discrepancyEur} EUR`,
    );
  }

  lines.push("");
  lines.push(`REFERENCE SCENARIOS: ${report.referenceScenariosAllPass ? "PASS" : "FAIL"}`);
  for (const scenario of report.referenceScenarios) {
    lines.push(`  ${scenario.name} (${scenario.topology})`);
    lines.push(
      `    revenue=${scenario.totalRevenueEur ?? "n/a"} EUR, exported=${scenario.exportedKwh} kWh, imported=${scenario.importedKwh} kWh`,
    );
    lines.push(
      `    charge=${scenario.chargeKwh} kWh, discharge=${scenario.dischargeKwh} kWh, throughput=${scenario.batteryThroughputKwh} kWh, round-trip losses=${scenario.roundTripLossesKwh} kWh`,
    );
    if (scenario.marketValueEur !== null) {
      lines.push(
        `    market value=${scenario.marketValueEur} EUR, battery wear cost=${scenario.batteryWearCostEur} EUR, optimization value=${scenario.optimizationValueEur} EUR`,
      );
    }
    lines.push(
      `    energy balance violations=${scenario.energyBalanceViolationCount}, constraint violations=${scenario.constraintViolationCount}`,
    );
    if (scenario.sampleViolations.length > 0) {
      lines.push(`    sample violations: ${JSON.stringify(scenario.sampleViolations)}`);
    }
  }

  lines.push("");
  lines.push(`OVERALL: ${report.overallPass ? "PASS" : "FAIL"}`);
  lines.push("=".repeat(72));

  return lines.join("\n");
}
