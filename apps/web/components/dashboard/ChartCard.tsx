import Card from "../ui/Card";
import CardHeader from "./CardHeader";
import ChartTabs from "./ChartTabs";
import LineChart from "./LineChart";

export default function ChartCard() {
  return (
    <Card className="mt-6 p-6">
      <CardHeader
        title="Plant Performance"
        subtitle="Aggregate output · last 24h"
        right={<ChartTabs />}
      />

      <LineChart />
    </Card>
  );
}