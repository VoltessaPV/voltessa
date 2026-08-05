# Canonical Entity Contract

The single reference for every physical and business quantity Voltessa computes or stores.
Dashboard, Market, Automation Lab, Digital Twin, and any future manufacturer adapter all consume
quantities exactly as defined here — nothing outside this contract may introduce a second
definition, a second stored representation, or a second update strategy for a quantity already
listed below.

See ADR-018 (`docs/ARCHITECT_DECISIONS.md`) for why this exists. This document is the frozen
contract itself; the ADR entry only records the decision to freeze it.

## The rule

Every quantity has exactly one of each:

- **Definition** — what it physically or financially means.
- **Representation** — either a specific stored column, or explicitly "never stored — always
  derived."
- **Update strategy** — exactly one of the three below.
- **Manufacturer mapping** — the Huawei field(s) it comes from today, as the template every future
  vendor adapter must fill in for its own vendor. The definition, representation, and update
  strategy never change per vendor — only this column does.

## The three update strategies

| Strategy | Meaning | Example |
| --- | --- | --- |
| **Ingested (real-time)** | Written every ingestion cycle (5 min) directly from a raw vendor reading, one row per device per timestamp | `DeviceTelemetry.activePower`, `.meterActivePower` |
| **Ingested (manufacturer total)** | Written once per day from the vendor's own settled daily/period counter, stored **verbatim** — never recomputed from raw telemetry, ever | `PlantDailyKpi.pvYieldKwh`, `.consumptionKwh` |
| **Derived (pure, on-demand)** | Never stored. Always computed at read time from one or more Ingested quantities, by exactly one function | Revenue, Self-Consumption, Current Export, Peak Export |

A quantity's row below states which of these three it is. This is the load-bearing fact in the
whole contract: it is what stops a future feature from caching a Derived quantity into a new
column, which is exactly how two disagreeing sources of truth get created.

## Canonical entities (existing tables, no schema change)

| Entity | Role |
| --- | --- |
| `DeviceTelemetry` | Canonical raw per-device, per-timestamp instantaneous readings (5-min grid) — inverter `activePower`, meter `meterActivePower` (signed), meter cumulative counters `activeEnergy`/`reverseActiveEnergy` |
| `PlantDailyKpi` | Canonical manufacturer-reported daily totals — production, consumption, exported energy, lifetime counter — stored exactly as the vendor reports them |
| `MarketPrice` | Canonical day-ahead price per interval — platform-wide, never vendor- or plant-specific |
| `Plant` / `Device` | Canonical topology — `capacityKw`, `vendor`, `devTypeId` (meter presence is the Prosumer/Producer signal, never org/plant name) |
| `AutomationSettings` / automation-state | Canonical automation configuration and last-known export mode |

## Canonical quantities

| Quantity | Definition | Representation | Update strategy | Huawei mapping | Canonical implementation | Consumers |
| --- | --- | --- | --- | --- | --- | --- |
| Current Production | Instantaneous inverter power, summed across a plant's inverters | Never stored | Derived, from newest `DeviceTelemetry` row per inverter | `getDevRealKpi` → `active_power` | `lib/telemetry/canonical.ts`: `getCurrentProduction` | Dashboard (Inverters, Energy Flow); Automation Lab plant-info panel |
| Current Export / Import | Instantaneous signed grid power | Never stored | Derived, from newest meter row; falls back to Current Production if no meter | Meter `active_power` | `lib/telemetry/canonical.ts`: `getCurrentGridReadings` | Dashboard (Energy Flow); Market (Current Export card, chart NOW annotation) |
| Historical Telemetry | Timestamp-aligned production/export/import series over a range | Never stored | Derived over Ingested (real-time) rows | — | `lib/telemetry/energy-metrics.ts`: `getPlantTelemetrySeries` | Dashboard (Live Energy chart); Market (Price & Export chart); Digital Twin replay input |
| Settlement Energy (per interval) | Real exported/imported kWh for one 15-minute interval | Never stored | Derived — meter counter delta (Prosumer) or inverter-power integration (Producer) | `active_cap`/`reverse_active_cap` counters, or integrated `active_power` | `lib/telemetry/energy-metrics.ts`: `getPlantSettlementEnergySeries` / `getPlantProductionEnergySeries` | Market (Revenue, chart bars); Dashboard (Exported/Imported Today); Digital Twin (scenario transform target, then unchanged Settlement Engine) |
| Daily Production | The vendor's own settled daily production total | `PlantDailyKpi.pvYieldKwh` | Ingested (manufacturer total), verbatim | `day_power` (today) / `PVYield` (historical) | `lib/telemetry/canonical.ts`: `getDailyTotals` | Dashboard (Yield Today); Market (Revenue's Producer fallback) |
| Daily Consumption | The vendor's own settled daily consumption total; `0` for a plant with no meter (a fact about topology, not missing data) | `PlantDailyKpi.consumptionKwh` | Ingested (manufacturer total) | `day_use_energy` / `use_power` | `lib/telemetry/canonical.ts`: `getDailyTotals` | Dashboard (Consumption Today); Digital Twin Prosumer scenario's fixed, never-changing baseline |
| Lifetime Production | Cumulative production counter as of the most recent imported day | Latest day's counter within `PlantDailyKpi` | Ingested (manufacturer total) | Lifetime/`total_power` | `lib/telemetry/canonical.ts`: `latestLifetimeProduction` | Dashboard (Total Yield) |
| Monthly / Yearly Production | Sum of already-canonical daily totals over a calendar period | Never stored | Derived — sum over `PlantDailyKpi` rows, never a second aggregation | — | `lib/telemetry/canonical.ts`: `getDailyTotals` (called with the full period range — Dashboard and Market already share this one call, confirmed no duplication) | Dashboard/Market (Week/Month/Year views) |
| Self-Consumption | Energy produced and used on-site, same interval/day | Never stored | Derived — exactly one identity, `production − export` | — | `lib/telemetry/energy-metrics.ts`: `computeConsumedFromPv` | Dashboard (Consumed from PV); Digital Twin Prosumer recompute |
| Revenue | Σ over settlement intervals of (exported kWh × that interval's real price) | Never stored | Derived, pure function over (price series, settlement series) | — | `lib/market-price/revenue.ts`: `computeExportRevenue` | Dashboard, Market (Revenue card); Digital Twin (Current vs. Simulated comparison) |
| Average Selling Price | Revenue ÷ exported energy | Never stored | Derived, same function as Revenue | — | `lib/market-price/revenue.ts`: `computeExportRevenue` | Market (Revenue row, ASP chart for Week/Month/Year) |
| Peak Export | Maximum meter export power in a range, with its timestamp | Never stored | Derived over Historical Telemetry | — | `lib/telemetry/energy-metrics.ts`: `computeEnergyMetricsFromSeries` | Dashboard/Market; Digital Twin results comparison |
| Export Mode / Automation Status | Plant's currently configured export-control mode and whether automation is enabled | `AutomationSettings.automationEnabled` + last-known mode | Ingested (event-driven, written on each control action) + Derived (read-back query) | Active Power Control mode | `lib/automation/automation-state.ts`; `lib/fusionsolar/get-active-power-control-mode.ts` | Market (Configured Mode card); Automation Lab (plant-info panel, read-export-config automation) |
| Curtailment | Production that could not be exported because it exceeded a scenario's export ceiling (an export limit, or physical capacity) and consumption | Never stored — does not exist in real historical data (no real plant has ever hit this ceiling) | Derived, Scenario layer only — never part of the Settlement/Revenue Engine itself | — | Digital Twin scenario module (Milestone 4) | Digital Twin only |

## Canonical engines

Three pure, stateless functions. "Pure" is load-bearing here too: given the same inputs, always the
same output, no database access inside them.

- **Energy Engine** — turns Ingested rows into per-interval production/export/import series
  (`lib/telemetry/energy-metrics.ts`).
- **Settlement Engine** — sums a series into totals, and derives Self-Consumption from the
  production/export identity (`lib/telemetry/energy-metrics.ts`).
- **Revenue Engine** — `computeExportRevenue(priceSeries, settlementSeries)`, unchanged regardless
  of what produced the settlement series (`lib/market-price/revenue.ts`).

Any caller — Dashboard, Market, Digital Twin — that wants Settlement Energy or Revenue calls these
same three functions with whatever series it has. Digital Twin's only allowed deviation is which
series it hands in (a scenario-adjusted one instead of the real one) — never a second
implementation of what Settlement or Revenue means. See ADR-018 for the full replay contract.

## ManufacturerControlAdapter

Automation is not yet part of this table's Derived/Ingested vocabulary because it is a command, not
a measured quantity — see ADR-018 for the `ManufacturerControlAdapter` contract and
`AutomationService`'s vendor-resolution rule. Atlanta's Chromium automation is explicitly outside
this contract — it is not, and will never be, a `ManufacturerControlAdapter`.
