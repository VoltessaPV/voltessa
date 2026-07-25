import { Battery } from "lucide-react";

import CardHeader from "@/components/dashboard/CardHeader";
import Card from "@/components/ui/Card";

/**
 * Informational-only, no controls: this plant has no battery hardware,
 * so there is nothing to configure. Not a feature flag or "coming soon" -
 * just an honest reflection of this plant's actual equipment.
 */
export function BatteryOptimizationCard() {
  return (
    <Card className="p-6 opacity-60">
      <CardHeader title="Battery Optimization" />

      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Battery className="h-4 w-4 shrink-0" />
        This plant has no battery storage installed.
      </div>
    </Card>
  );
}
