package ai.voltessa.mobile.ui.screens

import ai.voltessa.mobile.data.AutomationSettingsResponse
import ai.voltessa.mobile.ui.components.DaySelectorGrid
import ai.voltessa.mobile.ui.components.SectionHeader
import ai.voltessa.mobile.ui.components.StatusBadge
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
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
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

private val ALL_DAYS = listOf(
    "MON" to "MONDAY",
    "TUE" to "TUESDAY",
    "WED" to "WEDNESDAY",
    "THU" to "THURSDAY",
    "FRI" to "FRIDAY",
    "SAT" to "SATURDAY",
    "SUN" to "SUNDAY",
)

/**
 * Mobile Redesign milestone - fixes the hard requirement that the day
 * selector was horizontally clipped (a `LazyRow` that silently overflowed
 * past the screen edge): `DaySelectorGrid` lays all 7 days out in a fixed
 * 4+3 grid instead, so every day is always visible with no scrolling, at
 * 360/390/430dp alike. An Automation Hero (ON/OFF, threshold, active days,
 * current mode) plus one short human sentence now leads the screen, ahead
 * of the editable form - still backed by the same GET/POST
 * /api/automation-settings endpoint, unchanged.
 */
@Composable
fun AutomationsScreen(
    isBusy: Boolean,
    settings: AutomationSettingsResponse?,
    errorMessage: String?,
    saveMessage: String?,
    onSave: (enabled: Boolean, minimumExportPrice: String, enabledDays: List<String>) -> Unit,
    onRefresh: () -> Unit,
) {
    var enabled by remember(settings) { mutableStateOf(settings?.automationEnabled ?: false) }
    var priceText by remember(settings) { mutableStateOf(settings?.minimumExportPrice ?: "") }
    var selectedDays by remember(settings) { mutableStateOf(settings?.enabledDays?.toSet() ?: emptySet()) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = onRefresh, enabled = !isBusy) { Text("Refresh") }
        }

        if (isBusy && settings == null) {
            CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
            return@Column
        }

        // --- Automation hero ---
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .padding(20.dp),
        ) {
            SectionHeader(title = "Market Price Optimization")
            Spacer(modifier = Modifier.height(10.dp))
            StatusBadge(
                text = if (enabled) "ON" else "OFF",
                color = if (enabled) VoltessaGreen else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(10.dp))
            Text(
                text = "Export automatically changes according to the market price.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(14.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = "Minimum export price", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        text = "${priceText.ifBlank { "—" }} ${settings?.currency ?: "EUR"}/MWh",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = "Active days", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(text = if (selectedDays.isEmpty()) "None" else "${selectedDays.size} / 7", style = MaterialTheme.typography.bodyLarge)
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // --- Editable form ---
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(text = "Enabled", style = MaterialTheme.typography.bodyLarge)
            Switch(checked = enabled, onCheckedChange = { enabled = it })
        }

        OutlinedTextField(
            value = priceText,
            onValueChange = { priceText = it },
            label = { Text("Minimum export price (${settings?.currency ?: "EUR"})") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
        )

        Spacer(modifier = Modifier.height(20.dp))
        SectionHeader(title = "Active Days")
        Spacer(modifier = Modifier.height(8.dp))
        DaySelectorGrid(
            days = ALL_DAYS,
            selected = selectedDays,
            onToggle = { day -> selectedDays = if (selectedDays.contains(day)) selectedDays - day else selectedDays + day },
        )

        if (errorMessage != null) {
            Text(text = errorMessage, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
        }
        if (saveMessage != null) {
            Text(text = saveMessage, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 16.dp))
        }

        Button(
            onClick = { onSave(enabled, priceText, selectedDays.toList()) },
            enabled = !isBusy,
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
        ) {
            Text("Save")
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Matches Web's BatteryOptimizationCard exactly: informational-only,
        // unconditional (every organization sees this same message today -
        // it reflects real equipment, not a feature flag), never presented
        // as a mobile-specific limitation.
        SectionHeader(title = "Battery Optimization")
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = "This plant has no battery storage installed.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
