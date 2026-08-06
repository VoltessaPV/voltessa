import type { MarketPricePoint } from "@/app/[locale]/(platform)/market/market-data";
import type { BatteryConfig, BatteryDispatchInterval } from "@/lib/digital-twin/battery-dispatch";

/**
 * Battery Engine Diagnostics milestone. Deliberately isolated from the UI
 * and from `battery-dispatch.ts` itself - every function here is a pure
 * derivation over the engine's own already-computed
 * `BatteryDispatchInterval[]` output (plus the same `BatteryConfig`/price
 * series the engine was run with), never a change to the engine. Reusable
 * from a script, a future admin diagnostic page, or a test - nothing here
 * depends on a request/response cycle.
 */

export type BatteryDispatchAction = "Idle" | "Charge from PV" | "Charge from Grid" | "Discharge" | "Export";

export type BatteryIntervalDiagnostic = {
  intervalStart: Date;
  availablePvKwh: number;
  consumptionKwh: number;
  gridImportKwh: number;
  gridExportKwh: number;
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
  socBeforeKwh: number;
  socAfterKwh: number;
  marketPriceEurPerMwh: number | null;
  action: BatteryDispatchAction;
  reason: string;
  /**
   * This interval's own realized contribution to total value -
   * price x (export - import) / 1000. This is NOT the DP's internal
   * value-to-go (that table is intentionally not exposed by
   * `battery-dispatch.ts` - see `battery-optimality-check.ts` for how
   * optimality is actually verified, independently, rather than by trying
   * to read the engine's internal state).
   */
  intervalRevenueEur: number;
};

const TOLERANCE_KWH = 0.02;

function classifyAction(
  interval: BatteryDispatchInterval,
  chargeFromGridKwh: number,
): { action: BatteryDispatchAction; reason: string } {
  if (interval.chargeKwh > TOLERANCE_KWH) {
    if (chargeFromGridKwh > TOLERANCE_KWH) {
      return {
        action: "Charge from Grid",
        reason: `Charging ${interval.chargeKwh.toFixed(2)} kWh, ${chargeFromGridKwh.toFixed(2)} kWh sourced from grid import.`,
      };
    }
    return { action: "Charge from PV", reason: `Charging ${interval.chargeKwh.toFixed(2)} kWh from PV surplus rather than exporting it immediately.` };
  }

  if (interval.dischargeKwh > TOLERANCE_KWH) {
    return {
      action: "Discharge",
      reason: `Discharging ${interval.dischargeKwh.toFixed(2)} kWh to the grid/consumption - judged more valuable now than holding for later.`,
    };
  }

  if (interval.exportedKwh > TOLERANCE_KWH) {
    return { action: "Export", reason: `Battery untouched; ${interval.exportedKwh.toFixed(2)} kWh of PV surplus exported directly.` };
  }

  return {
    action: "Idle",
    reason:
      interval.importedKwh > TOLERANCE_KWH
        ? `Battery untouched; ${interval.importedKwh.toFixed(2)} kWh of consumption deficit imported directly.`
        : "No PV surplus, no deficit, no beneficial battery action this interval.",
  };
}

/**
 * `intervals` is assumed to be one plant's `BatteryDispatchInterval[]` in
 * chronological order, exactly as `replayBatteryScenario`/
 * `runBatteryDispatch` returns it - `socBeforeKwh` for interval 0 is
 * derived the same way the engine itself starts (`minSocPercent` of
 * `capacityKwh`), and every later interval's "before" is simply the
 * previous interval's "after".
 */
export function buildIntervalDiagnostics(
  intervals: BatteryDispatchInterval[],
  priceSeries: MarketPricePoint[],
  battery: BatteryConfig,
): BatteryIntervalDiagnostic[] {
  const priceByTime = new Map(priceSeries.map((p) => [p.timestamp.getTime(), p.price]));
  let socBefore = (battery.minSocPercent / 100) * battery.capacityKwh;

  return intervals.map((interval): BatteryIntervalDiagnostic => {
    const surplusKwh = Math.max(0, interval.availablePvKwh - interval.consumptionKwh);
    const chargeFromPvKwh = Math.min(interval.chargeKwh, surplusKwh);
    const chargeFromGridKwh = Math.max(0, interval.chargeKwh - chargeFromPvKwh);

    const { action, reason } = classifyAction(interval, chargeFromGridKwh);
    const price = priceByTime.get(interval.intervalStart.getTime()) ?? null;
    const intervalRevenueEur =
      price !== null ? Math.round(((price * (interval.exportedKwh - interval.importedKwh)) / 1000) * 100) / 100 : 0;

    const diagnostic: BatteryIntervalDiagnostic = {
      intervalStart: interval.intervalStart,
      availablePvKwh: interval.availablePvKwh,
      consumptionKwh: interval.consumptionKwh,
      gridImportKwh: interval.importedKwh,
      gridExportKwh: interval.exportedKwh,
      batteryChargeKwh: interval.chargeKwh,
      batteryDischargeKwh: interval.dischargeKwh,
      socBeforeKwh: Math.round(socBefore * 100) / 100,
      socAfterKwh: interval.socKwh,
      marketPriceEurPerMwh: price,
      action,
      reason,
      intervalRevenueEur,
    };

    socBefore = interval.socKwh;
    return diagnostic;
  });
}

export type EnergyBalanceViolation = {
  intervalStart: Date;
  energyInKwh: number;
  energyOutKwh: number;
  storageDeltaKwh: number;
  lossesKwh: number;
  discrepancyKwh: number;
};

const BALANCE_TOLERANCE_KWH = 0.05;

/**
 * Independently re-derives, for every interval, whether
 * Energy In = Energy Out + Storage Delta + Losses:
 *
 *   Energy In      = availablePv + gridImport
 *   Energy Out     = consumption + gridExport
 *   Storage Delta  = socAfter - socBefore
 *   Losses         = charge x (1 - etaCharge) + discharge x (1/etaDischarge - 1)
 *
 * `Losses` is computed here from `battery.roundTripEfficiencyPercent`
 * alone - it does not read anything `battery-dispatch.ts` computed
 * internally, so a passing result genuinely re-proves the physics rather
 * than re-checking the engine's own arithmetic against itself. Both loss
 * terms are provably >= 0 (etaCharge, etaDischarge < 1), matching the
 * physical expectation that round-trip storage always loses energy, never
 * gains it.
 */
export function validateEnergyBalance(
  diagnostics: BatteryIntervalDiagnostic[],
  battery: BatteryConfig,
): EnergyBalanceViolation[] {
  const eta = Math.sqrt(battery.roundTripEfficiencyPercent / 100);
  const violations: EnergyBalanceViolation[] = [];

  for (const d of diagnostics) {
    const energyIn = d.availablePvKwh + d.gridImportKwh;
    const energyOut = d.consumptionKwh + d.gridExportKwh;
    const storageDelta = d.socAfterKwh - d.socBeforeKwh;
    const losses = d.batteryChargeKwh * (1 - eta) + d.batteryDischargeKwh * (1 / eta - 1);
    const discrepancy = energyIn - energyOut - storageDelta - losses;

    if (Math.abs(discrepancy) > BALANCE_TOLERANCE_KWH) {
      violations.push({
        intervalStart: d.intervalStart,
        energyInKwh: Math.round(energyIn * 100) / 100,
        energyOutKwh: Math.round(energyOut * 100) / 100,
        storageDeltaKwh: Math.round(storageDelta * 100) / 100,
        lossesKwh: Math.round(losses * 100) / 100,
        discrepancyKwh: Math.round(discrepancy * 100) / 100,
      });
    }
  }

  return violations;
}

export type ConstraintCheckId =
  | "soc_within_limits"
  | "charge_power_within_limit"
  | "discharge_power_within_limit"
  | "grid_charging_respected"
  | "pv_only_charging_never_uses_grid"
  | "available_pv_never_exceeded"
  | "import_export_physically_valid";

export type ConstraintViolation = {
  check: ConstraintCheckId;
  intervalStart: Date;
  detail: string;
};

const INTERVAL_HOURS = 15 / 60;

/** All seven constraint checks the milestone lists, each independently derived from `battery` config - none of them trust the engine's own internal bounds-checking. */
export function validateConstraints(diagnostics: BatteryIntervalDiagnostic[], battery: BatteryConfig): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  const minSocKwh = (battery.minSocPercent / 100) * battery.capacityKwh;
  const maxSocKwh = (battery.maxSocPercent / 100) * battery.capacityKwh;
  const maxChargeKwh = battery.maxChargePowerKw * INTERVAL_HOURS;
  const maxDischargeKwh = battery.maxDischargePowerKw * INTERVAL_HOURS;

  for (const d of diagnostics) {
    if (
      d.socBeforeKwh < minSocKwh - TOLERANCE_KWH ||
      d.socBeforeKwh > maxSocKwh + TOLERANCE_KWH ||
      d.socAfterKwh < minSocKwh - TOLERANCE_KWH ||
      d.socAfterKwh > maxSocKwh + TOLERANCE_KWH
    ) {
      violations.push({
        check: "soc_within_limits",
        intervalStart: d.intervalStart,
        detail: `SOC ${d.socBeforeKwh} -> ${d.socAfterKwh} kWh, outside [${minSocKwh}, ${maxSocKwh}]`,
      });
    }

    if (d.batteryChargeKwh > maxChargeKwh + TOLERANCE_KWH) {
      violations.push({
        check: "charge_power_within_limit",
        intervalStart: d.intervalStart,
        detail: `Charged ${d.batteryChargeKwh} kWh, limit ${maxChargeKwh} kWh/interval`,
      });
    }

    if (d.batteryDischargeKwh > maxDischargeKwh + TOLERANCE_KWH) {
      violations.push({
        check: "discharge_power_within_limit",
        intervalStart: d.intervalStart,
        detail: `Discharged ${d.batteryDischargeKwh} kWh, limit ${maxDischargeKwh} kWh/interval`,
      });
    }

    const surplusKwh = Math.max(0, d.availablePvKwh - d.consumptionKwh);
    const chargeFromGridKwh = Math.max(0, d.batteryChargeKwh - Math.min(d.batteryChargeKwh, surplusKwh));

    if (!battery.allowGridCharging && chargeFromGridKwh > TOLERANCE_KWH) {
      violations.push({
        check: "grid_charging_respected",
        intervalStart: d.intervalStart,
        detail: `allowGridCharging is false but ${chargeFromGridKwh} kWh appears to be grid-sourced charge`,
      });
    }

    if (!battery.allowGridCharging && d.batteryChargeKwh > surplusKwh + TOLERANCE_KWH) {
      violations.push({
        check: "pv_only_charging_never_uses_grid",
        intervalStart: d.intervalStart,
        detail: `Charged ${d.batteryChargeKwh} kWh but only ${surplusKwh} kWh of PV surplus was available`,
      });
    }

    if (!battery.allowGridCharging && d.batteryChargeKwh > d.availablePvKwh + TOLERANCE_KWH) {
      violations.push({
        check: "available_pv_never_exceeded",
        intervalStart: d.intervalStart,
        detail: `Charge ${d.batteryChargeKwh} kWh exceeds Available PV ${d.availablePvKwh} kWh`,
      });
    }

    if (d.gridImportKwh < -TOLERANCE_KWH || d.gridExportKwh < -TOLERANCE_KWH) {
      violations.push({
        check: "import_export_physically_valid",
        intervalStart: d.intervalStart,
        detail: `Negative import/export: import=${d.gridImportKwh}, export=${d.gridExportKwh}`,
      });
    }

    if (d.gridImportKwh > TOLERANCE_KWH && d.gridExportKwh > TOLERANCE_KWH) {
      violations.push({
        check: "import_export_physically_valid",
        intervalStart: d.intervalStart,
        detail: `Simultaneous import (${d.gridImportKwh}) and export (${d.gridExportKwh}) in the same interval`,
      });
    }
  }

  return violations;
}
