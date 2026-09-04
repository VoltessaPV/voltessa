package ai.voltessa.mobile.ui.screens

import ai.voltessa.mobile.data.MarketPageResponse
import ai.voltessa.mobile.ui.components.ChartLine
import ai.voltessa.mobile.ui.components.TimeSeriesLineChart
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import java.time.Instant

private val PRICE_LINE_COLOR = Color(0xFFFFC53D)

/** "Zero Export" / "No Limit" (AutomationState.currentExportMode, verbatim) -> a friendlier phone-sized label. `null` (never executed yet) reads as "Unknown", never a blank line. */
private fun exportModeLabel(mode: String?): String = when (mode) {
    "Zero Export" -> "Zero Export"
    "No Limit" -> "No Limit"
    else -> "Unknown"
}

/**
 * Real Market section, backed by GET /api/plants/:plantId/market (reuses
 * `getMarketPageData` verbatim server-side, plus `currentExportMode` - see
 * that route's own doc comment). Mobile/Web Parity milestone: adds the
 * price chart (`series`, already present in this endpoint's response but
 * previously unmodeled/unrendered) and the pre-computed `insights` text,
 * reorganized into the sections the Web Market page itself groups this
 * same data into - Current status, Chart, Market information, Source.
 * Deliberately still "today" only, matching this screen's existing scope -
 * no week/month/year period switcher.
 */
@Composable
fun MarketScreen(
    isBusy: Boolean,
    market: MarketPageResponse?,
    errorMessage: String?,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = onRefresh, enabled = !isBusy) { Text("Refresh") }
        }

        if (isBusy) {
            CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
            return@Column
        }

        if (errorMessage != null) {
            Text(text = errorMessage, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
            return@Column
        }

        if (market == null || !market.dataAvailable) {
            Text(
                text = "No market data available yet.",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 16.dp),
            )
            return@Column
        }

        val summary = market.summary

        // --- Current market status ---
        Text(text = "Current Price", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp))
        val currentPrice = summary?.currentPrice
        if (currentPrice != null) {
            Text(
                text = "${currentPrice.value} ${currentPrice.currency}/MWh (${currentPrice.intervalLabel})",
                style = MaterialTheme.typography.headlineSmall,
            )
            Text(
                text = "Change vs. previous interval: ${currentPrice.deltaVsPrevious}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Text(text = "Unavailable.", style = MaterialTheme.typography.bodyMedium)
        }

        summary?.nextInterval?.let {
            Text(
                text = "Next interval (${it.intervalLabel}): ${it.value} - ${it.direction}",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 4.dp),
            )
        }

        // weight(1f) on both columns (not just Arrangement.SpaceBetween on
        // their wrap-content widths) - on a narrow phone, "Configured mode"
        // and "Export threshold" are wide enough on their own that
        // SpaceBetween had ~0px left to distribute, so the two columns
        // rendered flush against each other with no gap (found on a real
        // 320dp-effective device). Each column now always gets exactly half
        // the row regardless of content length.
        Row(modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = "Configured mode", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(text = exportModeLabel(market.currentExportMode), style = MaterialTheme.typography.bodyLarge)
            }
            market.threshold?.let {
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = "Export threshold", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(text = "${it.minimumExportPrice} ${it.currency}/MWh", style = MaterialTheme.typography.bodyLarge)
                }
            }
        }

        // --- Market chart ---
        if (market.series.isNotEmpty()) {
            HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
            Text(text = "Price Today", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 8.dp))
            TimeSeriesLineChart(
                times = market.series.map { Instant.parse(it.timestamp).toEpochMilli() },
                lines = listOf(
                    ChartLine(label = "Price (${currentPrice?.currency ?: "EUR"}/MWh)", color = PRICE_LINE_COLOR, values = market.series.map { it.price }),
                ),
                referenceLine = market.threshold?.minimumExportPrice,
                valueFormatter = { "%.0f".format(it) },
            )
        }

        // --- Today's range ---
        HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
        Text(text = "Today's Range", style = MaterialTheme.typography.titleMedium)
        summary?.lowestToday?.let { Text(text = "Lowest: ${it.value} (${it.intervalLabel})", style = MaterialTheme.typography.bodyMedium) }
        summary?.highestToday?.let { Text(text = "Highest: ${it.value} (${it.intervalLabel})", style = MaterialTheme.typography.bodyMedium) }

        // --- Market information (pre-computed server-side, never recomputed here) ---
        if (market.insights.isNotEmpty()) {
            HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
            Text(text = "Market Information", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 8.dp))
            market.insights.forEach { insight ->
                Text(text = insight.text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(bottom = 2.dp))
            }
        }

        if (market.distribution.isNotEmpty()) {
            HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
            Text(text = "Price Distribution", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 8.dp))
            market.distribution.forEach { bucket ->
                Text(
                    text = "${bucket.label} (${bucket.rangeLabel}): ${bucket.percentage}%",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }

        // --- Source/status ---
        summary?.marketStatus?.let {
            HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
            Text(text = "Country: ${it.country}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                text = "Source: ${it.source} - ${if (it.healthy) "Healthy" else "Degraded"}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (market.isPartialImport) {
            Text(
                text = "Today's prices are still being completed - some intervals may be missing.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 4.dp),
            )
        }

        if (market.eventLog.isNotEmpty()) {
            HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
            Text(text = "Recent Events", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 8.dp))
            market.eventLog.take(10).forEach { event ->
                Text(text = "${event.label}${event.detail?.let { " - $it" } ?: ""}", style = MaterialTheme.typography.bodyMedium)
                Text(text = event.timestamp, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
