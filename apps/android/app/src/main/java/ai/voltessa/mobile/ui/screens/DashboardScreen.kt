package ai.voltessa.mobile.ui.screens

import ai.voltessa.mobile.data.DashboardResponse
import ai.voltessa.mobile.data.EnergyFlowPointDto
import ai.voltessa.mobile.data.PlantConnectionResponse
import ai.voltessa.mobile.data.PlantDto
import ai.voltessa.mobile.ui.components.ChartLine
import ai.voltessa.mobile.ui.components.HeroCard
import ai.voltessa.mobile.ui.components.Metric
import ai.voltessa.mobile.ui.components.MetricGrid
import ai.voltessa.mobile.ui.components.SectionHeader
import ai.voltessa.mobile.ui.components.TimeSeriesLineChart
import ai.voltessa.mobile.ui.components.solarConditionLabel
import ai.voltessa.mobile.ui.theme.VoltessaAmber
import ai.voltessa.mobile.ui.theme.VoltessaGreen
import ai.voltessa.mobile.ui.theme.VoltessaOrange
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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp

/**
 * Mobile Redesign milestone - "glanceable intelligence": a live status HERO
 * (derived from the latest real `chartSeries` point, never hardcoded) leads
 * the screen, followed by a premium Today KPI grid, an energy-flow chart
 * (now including the Grid series `chartSeries` already carries but this
 * screen never plotted), a compact Weather card, and the Market widget -
 * all real fields already returned by GET /api/plants/:plantId/dashboard,
 * only reorganized/re-presented. No new endpoint, no invented value.
 *
 * M4.1's plant-selection behavior (Dashboard shows the default/selected
 * plant directly; the compact switcher only appears for >1 plant) is
 * unchanged - this redesign only touches presentation below the header.
 */
@Composable
fun DashboardScreen(
    isBusy: Boolean,
    plants: List<PlantDto>,
    plantsError: String?,
    selectedPlant: PlantDto?,
    connection: PlantConnectionResponse?,
    dashboard: DashboardResponse?,
    detailError: String?,
    onSelectPlant: (PlantDto) -> Unit,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        // --- Compact header ---
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                if (selectedPlant != null && plants.size > 1) {
                    PlantSelector(plants = plants, selectedPlant = selectedPlant, onSelectPlant = onSelectPlant)
                } else {
                    Text(
                        text = selectedPlant?.name ?: "Dashboard",
                        style = MaterialTheme.typography.titleLarge,
                    )
                }
                val connectionLabel = when {
                    connection == null -> "Connection status unavailable"
                    connection.connected -> "Connected" + (connection.provider?.let { " · $it" } ?: "")
                    else -> "Not connected"
                }
                Text(text = connectionLabel, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick = onRefresh, enabled = !isBusy) { Text("Refresh") }
        }

        if (plantsError != null) {
            Text(text = plantsError, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
            return@Column
        }

        if (selectedPlant == null) {
            if (isBusy) {
                CircularProgressIndicator(modifier = Modifier.padding(top = 16.dp))
            } else {
                Text(
                    text = "No plants connected yet. Connect a plant on the Voltessa web app.",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(top = 16.dp),
                )
            }
            return@Column
        }

        if (isBusy) {
            CircularProgressIndicator(modifier = Modifier.padding(top = 16.dp))
            return@Column
        }

        if (detailError != null) {
            Text(text = detailError, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
            return@Column
        }

        when {
            dashboard == null -> Text(
                text = "Dashboard unavailable.",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 16.dp),
            )

            !dashboard.plantAvailable -> Text(
                text = "No dashboard data available for this plant yet.",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 16.dp),
            )

            else -> DashboardBody(dashboard)
        }
    }
}

@Composable
private fun DashboardBody(dashboard: DashboardResponse) {
    val latestPoint = dashboard.chartSeries.lastOrNull { it.pvKw != null || it.consumptionKw != null }
    val livePvKw = latestPoint?.pvKw
    val liveGridExportKw = latestPoint?.gridExportKw
    val liveGridImportKw = latestPoint?.gridImportKw

    val (heroTitle, heroValue, heroStatus, heroColor) = when {
        livePvKw != null && livePvKw > 0.05 -> HeroPresentation(
            "PRODUCING",
            livePvKw,
            if (liveGridExportKw != null && liveGridExportKw > 0.05) "EXPORTING TO GRID" else "SELF-CONSUMING",
            VoltessaGreen,
        )
        liveGridImportKw != null && liveGridImportKw > 0.05 -> HeroPresentation(
            "IMPORTING",
            liveGridImportKw,
            "DRAWING FROM GRID",
            VoltessaAmber,
        )
        latestPoint != null -> HeroPresentation("IDLE", 0.0, "NO PRODUCTION", MaterialTheme.colorScheme.onSurfaceVariant)
        else -> null
    } ?: HeroPresentation(null, null, null, MaterialTheme.colorScheme.onSurfaceVariant)

    // --- Live status hero ---
    if (heroValue != null) {
        HeroCard(
            title = heroTitle,
            value = "%.1f".format(heroValue),
            unit = dashboard.chartUnit ?: "kW",
            statusText = heroStatus,
            statusColor = heroColor,
            subtitle = dashboard.latestTelemetryAt?.let { "Updated $it" },
        )
        Spacer(modifier = Modifier.height(20.dp))
    }

    // --- Today KPI grid ---
    SectionHeader(title = "Today")
    Spacer(modifier = Modifier.height(8.dp))
    val kpis = dashboard.kpis
    if (kpis != null) {
        MetricGrid(
            metrics = listOf(
                Metric("Production", formatKwh(kpis.producedTodayKwh), "kWh", VoltessaGreen),
                Metric("Consumption", formatKwh(kpis.consumedTodayKwh), "kWh", VoltessaAmber),
                Metric("Exported", formatKwh(kpis.exportedTodayKwh), "kWh", VoltessaGreen),
                Metric("Imported", formatKwh(kpis.importedTodayKwh), "kWh", VoltessaOrange),
                Metric("Self-consumption", selfConsumptionPercent(kpis.producedTodayKwh, kpis.consumedFromPvKwh), "%"),
                Metric("Total Yield", formatKwh(kpis.totalYieldKwh), "kWh"),
            ),
        )
    } else {
        Text(text = "No KPI data available.", style = MaterialTheme.typography.bodyMedium)
    }

    Spacer(modifier = Modifier.height(24.dp))

    // --- Energy flow chart (now including Grid, not just PV/Consumption) ---
    SectionHeader(title = "Energy Flow")
    Spacer(modifier = Modifier.height(8.dp))
    DashboardEnergyChart(points = dashboard.chartSeries, unit = dashboard.chartUnit ?: "kW")

    Spacer(modifier = Modifier.height(24.dp))

    // --- Weather (compact) ---
    SectionHeader(title = "Weather")
    Spacer(modifier = Modifier.height(8.dp))
    WeatherCompactCard(dashboard.weather)

    Spacer(modifier = Modifier.height(24.dp))

    // --- Market widget (secondary here - the full Market screen has its own hero) ---
    SectionHeader(title = "Market Price")
    Spacer(modifier = Modifier.height(8.dp))
    val market = dashboard.market
    val currentPrice = market?.currentPrice
    if (currentPrice != null) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .padding(14.dp),
        ) {
            Text(
                text = "${"%.2f".format(currentPrice.value)} ${currentPrice.currency}/MWh",
                style = MaterialTheme.typography.titleMedium,
            )
            Text(text = currentPrice.intervalLabel, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (market.exportRecommended != null) {
                Spacer(modifier = Modifier.height(6.dp))
                val recommended = market.exportRecommended
                ai.voltessa.mobile.ui.components.StatusBadge(
                    text = if (recommended) "EXPORT RECOMMENDED" else "EXPORT NOT RECOMMENDED",
                    color = if (recommended) VoltessaGreen else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    } else {
        Text(text = "Market price unavailable.", style = MaterialTheme.typography.bodyMedium)
    }
}

private data class HeroPresentation(val title: String?, val value: Double?, val status: String?, val color: androidx.compose.ui.graphics.Color)

@Composable
private fun DashboardEnergyChart(points: List<EnergyFlowPointDto>, unit: String) {
    if (points.isEmpty()) {
        Text(text = "No chart data available for this period.", style = MaterialTheme.typography.bodyMedium)
        return
    }

    val now = remember { System.currentTimeMillis() }
    TimeSeriesLineChart(
        times = points.map { it.time },
        lines = listOf(
            ChartLine(label = "Production", color = VoltessaGreen, values = points.map { it.pvKw }, filled = true),
            ChartLine(label = "Consumption", color = VoltessaAmber, values = points.map { it.consumptionKw }),
            ChartLine(label = "Grid import", color = VoltessaOrange, values = points.map { it.gridImportKw }),
        ),
        valueFormatter = { "%.1f".format(it) },
        nowMillis = now,
    )
}

@Composable
private fun WeatherCompactCard(weather: ai.voltessa.mobile.data.SolarWeatherDto?) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (weather != null) {
            val condition = solarConditionLabel(weather.current.cloudCover, weather.current.weatherCode)
            // `weight(1f)` on the text column (not the temperature) - without it, an
            // unweighted Row child can claim the card's full width for its own
            // intrinsic size, leaving nothing for its sibling and forcing "26°C"
            // to wrap character-by-character (found on a real device at 320dp
            // effective width). The temperature stays unweighted/single-line so
            // it never wraps, and the text column now wraps its own long line
            // instead of stealing the temperature's space.
            Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
                Text(text = condition, style = MaterialTheme.typography.bodyLarge)
                Text(
                    text = "Cloud cover ${weather.current.cloudCover.toInt()}% · Wind ${"%.1f".format(weather.current.windSpeed)} m/s",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                text = "${weather.current.temperature.toInt()}°C",
                style = MaterialTheme.typography.headlineSmall,
                maxLines = 1,
            )
        } else {
            Text(text = "Weather unavailable for this plant.", style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/** Compact plant switcher - only ever rendered when there's more than one plant (see DashboardScreen's own gate above). */
@Composable
private fun PlantSelector(plants: List<PlantDto>, selectedPlant: PlantDto, onSelectPlant: (PlantDto) -> Unit) {
    var expanded by remember { mutableStateOf(false) }

    Column {
        TextButton(onClick = { expanded = true }) {
            Text(text = "${selectedPlant.name} ▾", style = MaterialTheme.typography.titleLarge)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            plants.forEach { plant ->
                DropdownMenuItem(
                    text = { Text(plant.name) },
                    onClick = {
                        expanded = false
                        onSelectPlant(plant)
                    },
                )
            }
        }
    }
}

private fun formatKwh(value: Double?): String = value?.let { "%.1f".format(it) } ?: "—"

private fun selfConsumptionPercent(producedKwh: Double?, consumedFromPvKwh: Double?): String {
    if (producedKwh == null || consumedFromPvKwh == null || producedKwh <= 0.0) return "—"
    return "%.0f".format((consumedFromPvKwh / producedKwh) * 100.0)
}
