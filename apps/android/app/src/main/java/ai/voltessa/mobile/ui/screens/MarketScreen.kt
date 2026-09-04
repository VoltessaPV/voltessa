package ai.voltessa.mobile.ui.screens

import ai.voltessa.mobile.data.MarketPageResponse
import ai.voltessa.mobile.ui.components.ChartLine
import ai.voltessa.mobile.ui.components.HeroCard
import ai.voltessa.mobile.ui.components.Metric
import ai.voltessa.mobile.ui.components.MetricGrid
import ai.voltessa.mobile.ui.components.SectionHeader
import ai.voltessa.mobile.ui.components.TimeSeriesLineChart
import ai.voltessa.mobile.ui.theme.VoltessaAmber
import ai.voltessa.mobile.ui.theme.VoltessaGreen
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import java.time.Instant

private val PRICE_LINE_COLOR = VoltessaAmber

/** "Zero Export" / "No Limit" (AutomationState.currentExportMode, verbatim) -> a friendlier phone-sized label. `null` (never executed yet) reads as "Unknown", never a blank line. */
private fun exportModeLabel(mode: String?): String = when (mode) {
    "Zero Export" -> "Zero Export"
    "No Limit" -> "No Limit"
    else -> "Unknown"
}

/**
 * Mobile Redesign milestone - Current Price HERO leads the screen (real
 * `exportRecommended`, read from the same series-level decision Web already
 * computes, never re-derived here), followed by Today's Market Summary
 * (including the real `revenue` field, computed server-side via the exact
 * same `computeExportRevenue` Web's Market page calls), the price chart,
 * Today's Range, compact Market Insights, secondary Market Information, and
 * Recent Events lowest in the hierarchy. Every field still comes from
 * GET /api/plants/:plantId/market, unchanged except for the two small,
 * additive backend fields above - no new endpoint, no invented data.
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
            .padding(20.dp),
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

        MarketBody(market)
    }
}

@Composable
private fun MarketBody(market: MarketPageResponse) {
    val summary = market.summary
    val currentPrice = summary?.currentPrice

    // --- Current price hero ---
    if (currentPrice != null) {
        val recommended = currentPrice.exportRecommended
        HeroCard(
            title = "Current Price",
            value = "%.2f".format(currentPrice.value),
            unit = "${currentPrice.currency}/MWh",
            statusText = when (recommended) {
                true -> "EXPORT RECOMMENDED"
                false -> "EXPORT NOT RECOMMENDED"
                null -> null
            },
            statusColor = if (recommended == true) VoltessaGreen else MaterialTheme.colorScheme.onSurfaceVariant,
            subtitle = summary.nextInterval?.let { "Next interval ${"%.2f".format(it.value)} ${currentPrice.currency}/MWh · ${it.intervalLabel}" },
        )
    } else {
        Text(text = "Price unavailable.", style = MaterialTheme.typography.bodyMedium)
    }

    Spacer(modifier = Modifier.height(16.dp))

    Row(modifier = Modifier.fillMaxWidth()) {
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

    Spacer(modifier = Modifier.height(24.dp))

    // --- Today's market summary (production/exported/revenue/average price) ---
    SectionHeader(title = "Today's Market Summary")
    Spacer(modifier = Modifier.height(8.dp))
    val revenue = market.revenue
    MetricGrid(
        metrics = listOfNotNull(
            revenue?.takeIf { it.available }?.let { Metric("Exported", "%.1f".format(it.exportedKwh ?: 0.0), "kWh", VoltessaGreen) },
            revenue?.takeIf { it.available }?.let { Metric("Revenue", "%.2f".format(it.revenueEur ?: 0.0), currentPrice?.currency ?: "EUR", VoltessaGreen) },
            revenue?.takeIf { it.available }?.let { Metric("Avg. selling price", "%.2f".format(it.averagePriceEurPerMwh ?: 0.0), "${currentPrice?.currency ?: "EUR"}/MWh") },
        ),
    )
    if (revenue == null || !revenue.available) {
        Text(text = "Revenue data isn't available yet for today.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }

    Spacer(modifier = Modifier.height(24.dp))

    // --- Price chart ---
    if (market.series.isNotEmpty()) {
        SectionHeader(title = "Price Today")
        Spacer(modifier = Modifier.height(8.dp))
        val now = remember { System.currentTimeMillis() }
        TimeSeriesLineChart(
            times = market.series.map { Instant.parse(it.timestamp).toEpochMilli() },
            lines = listOf(
                ChartLine(label = "Price (${currentPrice?.currency ?: "EUR"}/MWh)", color = PRICE_LINE_COLOR, values = market.series.map { it.price }, filled = true),
            ),
            referenceLine = market.threshold?.minimumExportPrice,
            valueFormatter = { "%.0f".format(it) },
            nowMillis = now,
        )
        Spacer(modifier = Modifier.height(24.dp))
    }

    // --- Today's range ---
    SectionHeader(title = "Today's Range")
    Spacer(modifier = Modifier.height(8.dp))
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        summary?.lowestToday?.let {
            RangeCard(label = "Lowest", value = "%.2f".format(it.value), timeLabel = it.intervalLabel, modifier = Modifier.weight(1f))
        }
        summary?.highestToday?.let {
            RangeCard(label = "Highest", value = "%.2f".format(it.value), timeLabel = it.intervalLabel, modifier = Modifier.weight(1f))
        }
    }

    Spacer(modifier = Modifier.height(24.dp))

    // --- Market insights (pre-computed server-side, never recomputed here) ---
    if (market.insights.isNotEmpty()) {
        SectionHeader(title = "Market Insights")
        Spacer(modifier = Modifier.height(8.dp))
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .padding(14.dp),
        ) {
            market.insights.forEachIndexed { index, insight ->
                if (index > 0) Spacer(modifier = Modifier.height(6.dp))
                Text(text = insight.text, style = MaterialTheme.typography.bodyMedium)
            }
        }
        Spacer(modifier = Modifier.height(24.dp))
    }

    if (market.distribution.isNotEmpty()) {
        SectionHeader(title = "Price Distribution")
        Spacer(modifier = Modifier.height(8.dp))
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .padding(14.dp),
        ) {
            market.distribution.forEachIndexed { index, bucket ->
                if (index > 0) Spacer(modifier = Modifier.height(6.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(text = "${bucket.label} (${bucket.rangeLabel})", style = MaterialTheme.typography.bodyMedium)
                    Text(text = "${bucket.percentage}%", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        Spacer(modifier = Modifier.height(24.dp))
    }

    // --- Market information (secondary metadata) ---
    summary?.marketStatus?.let {
        SectionHeader(title = "Market Information")
        Spacer(modifier = Modifier.height(8.dp))
        Text(text = "Country: ${it.country}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            text = "Source: ${it.source} · ${if (it.healthy) "Healthy" else "Degraded"}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(24.dp))
    }
    if (market.isPartialImport) {
        Text(
            text = "Today's prices are still being completed - some intervals may be missing.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.padding(bottom = 16.dp),
        )
    }

    // --- Recent events (lowest in hierarchy) ---
    if (market.eventLog.isNotEmpty()) {
        SectionHeader(title = "Recent Events")
        Spacer(modifier = Modifier.height(8.dp))
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .padding(14.dp),
        ) {
            market.eventLog.take(10).forEachIndexed { index, event ->
                if (index > 0) Spacer(modifier = Modifier.height(10.dp))
                Text(text = "${event.label}${event.detail?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.bodyMedium)
                Text(text = event.timestamp, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun RangeCard(label: String, value: String, timeLabel: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(14.dp),
    ) {
        Text(text = label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 4.dp)) {
            Text(text = value, style = MaterialTheme.typography.titleLarge)
        }
        Text(text = timeLabel, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
