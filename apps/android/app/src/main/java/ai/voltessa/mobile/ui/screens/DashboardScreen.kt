package ai.voltessa.mobile.ui.screens

import ai.voltessa.mobile.data.DashboardResponse
import ai.voltessa.mobile.data.PlantConnectionResponse
import ai.voltessa.mobile.data.PlantDto
import ai.voltessa.mobile.ui.components.EnergyFlowChart
import ai.voltessa.mobile.ui.components.solarConditionLabel
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.unit.dp

/**
 * M4.1 - Dashboard shows the selected/default plant's data directly, with
 * no separate "select a plant" screen gating it (per the explicit UX fix:
 * Web goes straight to the current plant's dashboard, so Mobile now does
 * too). `plants`/`onSelectPlant` still exist purely to power the compact
 * selector below the header, shown ONLY when the organization has more
 * than one plant - a single-plant organization (the common case per
 * CLAUDE.md's own single-plant MVP assumption) never sees any
 * plant-selection UI at all.
 *
 * Body content (connection/KPIs/chart/weather/market) is the same
 * rendering M3's PlantDetailScreen already had - moved here verbatim, not
 * reimplemented, now that there's no separate Plants-list screen to route
 * to it from.
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
            .padding(24.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (selectedPlant != null && plants.size > 1) {
                PlantSelector(plants = plants, selectedPlant = selectedPlant, onSelectPlant = onSelectPlant)
            } else if (selectedPlant != null) {
                Text(text = selectedPlant.name, style = MaterialTheme.typography.headlineSmall)
            } else {
                Text(text = "Dashboard", style = MaterialTheme.typography.headlineSmall)
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

        Text(text = "Connection", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp))
        if (connection != null) {
            Text(
                text = if (connection.connected) {
                    "Connected" + (connection.provider?.let { " ($it)" } ?: "")
                } else {
                    "Not connected"
                },
                style = MaterialTheme.typography.bodyMedium,
            )
        } else {
            Text(text = "Connection status unavailable.", style = MaterialTheme.typography.bodyMedium)
        }

        HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))

        when {
            dashboard == null -> Text(text = "Dashboard unavailable.", style = MaterialTheme.typography.bodyMedium)

            !dashboard.plantAvailable -> Text(
                text = "No dashboard data available for this plant yet.",
                style = MaterialTheme.typography.bodyMedium,
            )

            else -> {
                val kpis = dashboard.kpis
                // Terminology matches Web's Dashboard exactly (messages/en/dashboard.json) -
                // a customer should never see two different names for the same number.
                Text(text = "Today", style = MaterialTheme.typography.titleMedium)
                if (kpis != null) {
                    KpiRow("Yield Today", kpis.producedTodayKwh, "kWh")
                    KpiRow("Consumption Today", kpis.consumedTodayKwh, "kWh")
                    KpiRow("Fed to Grid", kpis.exportedTodayKwh, "kWh")
                    KpiRow("From Grid", kpis.importedTodayKwh, "kWh")
                    KpiRow("Consumed from PV", kpis.consumedFromPvKwh, "kWh")
                    KpiRow("Total Yield", kpis.totalYieldKwh, "kWh")
                } else {
                    Text(text = "No KPI data available.", style = MaterialTheme.typography.bodyMedium)
                }
                if (dashboard.latestTelemetryAt != null) {
                    Text(
                        text = "Last update: ${dashboard.latestTelemetryAt}",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }

                HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))

                Text(text = "Production / Consumption", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 8.dp))
                EnergyFlowChart(points = dashboard.chartSeries, unit = dashboard.chartUnit ?: "kW")

                HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))

                Text(text = "Weather", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 8.dp))
                val weather = dashboard.weather
                if (weather != null) {
                    val condition = solarConditionLabel(weather.current.cloudCover, weather.current.weatherCode)
                    Text(text = condition, style = MaterialTheme.typography.bodyMedium)
                    Text(text = "Temperature: ${weather.current.temperature}°C", style = MaterialTheme.typography.bodySmall)
                    Text(text = "Cloud cover: ${weather.current.cloudCover}%", style = MaterialTheme.typography.bodySmall)
                    Text(text = "Wind: ${weather.current.windSpeed} m/s", style = MaterialTheme.typography.bodySmall)
                } else {
                    Text(text = "Weather unavailable for this plant.", style = MaterialTheme.typography.bodyMedium)
                }

                HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))

                Text(text = "Market Price", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 8.dp))
                val market = dashboard.market
                val currentPrice = market?.currentPrice
                if (currentPrice != null) {
                    Text(
                        text = "${currentPrice.value} ${currentPrice.currency} (${currentPrice.intervalLabel})",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    if (market.exportRecommended != null) {
                        Text(
                            text = if (market.exportRecommended) "Export recommended" else "Export not recommended",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    market.threshold?.let {
                        Text(
                            text = "Threshold: ${it.minimumExportPrice} ${it.currency}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                } else {
                    Text(text = "Market price unavailable.", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

/** Compact plant switcher - only ever rendered when there's more than one plant (see DashboardScreen's own gate above). */
@Composable
private fun PlantSelector(plants: List<PlantDto>, selectedPlant: PlantDto, onSelectPlant: (PlantDto) -> Unit) {
    var expanded by remember { mutableStateOf(false) }

    Column {
        TextButton(onClick = { expanded = true }) {
            Text(text = "${selectedPlant.name} ▾", style = MaterialTheme.typography.headlineSmall)
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

@Composable
private fun KpiRow(label: String, value: Double?, unit: String) {
    Text(
        text = "$label: ${value?.let { "%.2f".format(it) } ?: "—"} $unit",
        style = MaterialTheme.typography.bodyMedium,
    )
}
