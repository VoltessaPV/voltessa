import type { DiagnosticParameterDefinition } from "@/lib/fusionsolar/diagnostic-tests";

import type { AutomationType } from "./manufacturer-control-adapter";

/**
 * Automation Lab's UI catalog — vendor-neutral metadata about the five
 * automations `AutomationService` supports today. Reuses
 * `DiagnosticParameterDefinition` (the same declarative "one generic input
 * per parameter" shape `app/dev/huawei-api` already renders) rather than a
 * second parameter-description type. Future automations extend this array
 * and `AutomationType` together — the page itself never hardcodes a
 * per-automation branch.
 */
export type AutomationCatalogEntry = {
  id: AutomationType;
  label: string;
  kind: "read" | "control";
  parameters: DiagnosticParameterDefinition[];
};

export const AUTOMATION_CATALOG: AutomationCatalogEntry[] = [
  { id: "read-inverter-status", label: "Read Inverter Status", kind: "read", parameters: [] },
  { id: "read-export-config", label: "Read Export Configuration", kind: "read", parameters: [] },
  { id: "zero-export", label: "Zero Export", kind: "control", parameters: [] },
  { id: "remove-export-limit", label: "Remove Export Limit", kind: "control", parameters: [] },
  {
    id: "set-export-limit",
    label: "Set Export Limit",
    kind: "control",
    parameters: [
      {
        name: "maxGridFeedInPowerKw",
        label: "Max grid feed-in power (kW)",
        type: "number",
        required: true,
        placeholder: "e.g. 50",
      },
    ],
  },
];
