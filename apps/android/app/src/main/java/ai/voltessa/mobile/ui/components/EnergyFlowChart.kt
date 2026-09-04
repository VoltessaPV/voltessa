package ai.voltessa.mobile.ui.components

import ai.voltessa.mobile.data.EnergyFlowPointDto
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Production/consumption visualization from dashboard-data.ts's
 * `chartSeries` (already returned, unmodified, by the existing
 * GET /api/plants/:plantId/dashboard - no new endpoint). Thin wrapper
 * around the shared `TimeSeriesLineChart` (Mobile/Web Parity milestone) -
 * this used to be its own bespoke, axis-less Canvas drawing; the actual
 * chart rendering now lives in one place shared with the Market price
 * chart, not duplicated.
 *
 * Still deliberately just production+consumption in this version - the
 * same two series this chart has always shown; gridImportKw/gridExportKw/
 * forecastPvKw remain a natural follow-up, not added here to keep this
 * change scoped to "fix the chart," not "redesign what it shows."
 */
@Composable
fun EnergyFlowChart(points: List<EnergyFlowPointDto>, unit: String) {
    if (points.isEmpty()) {
        Text(
            text = "No chart data available for this period.",
            style = MaterialTheme.typography.bodyMedium,
        )
        return
    }

    TimeSeriesLineChart(
        times = points.map { it.time },
        lines = listOf(
            ChartLine(label = "Production ($unit)", color = Color(0xFFFFC53D), values = points.map { it.pvKw }),
            ChartLine(label = "Consumption ($unit)", color = Color(0xFF3D7BFF), values = points.map { it.consumptionKw }),
        ),
    )
}
