package ai.voltessa.mobile.ui.screens

import ai.voltessa.mobile.data.AutomationSettingsResponse
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.unit.dp

private val ALL_DAYS = listOf("MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY")

/**
 * M4 - real Automations section: Market Price Optimization enable/
 * threshold/day-of-week editing, backed by the new
 * GET/POST /api/automation-settings endpoint (reuses
 * `updateMarketPriceAutomationForOrganization` verbatim server-side - the
 * same validation/upsert logic Web's Automations page already uses, only
 * extracted so both callers share it instead of duplicating it).
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
            .padding(24.dp),
    ) {
        // No in-body title here - the TopAppBar already shows "Automations".
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = onRefresh, enabled = !isBusy) { Text("Refresh") }
        }

        Text(
            text = "Market Price Optimization",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(top = 16.dp, bottom = 8.dp),
        )

        if (isBusy && settings == null) {
            CircularProgressIndicator(modifier = Modifier.padding(top = 16.dp))
            return@Column
        }

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

        Text(text = "Active days", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp))

        LazyRow {
            items(ALL_DAYS) { day ->
                FilterChip(
                    selected = selectedDays.contains(day),
                    onClick = {
                        selectedDays = if (selectedDays.contains(day)) selectedDays - day else selectedDays + day
                    },
                    label = { Text(day.take(3)) },
                    modifier = Modifier.padding(end = 8.dp).wrapContentWidth(),
                )
            }
        }

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

        HorizontalDivider(modifier = Modifier.padding(vertical = 24.dp))

        // Matches Web's BatteryOptimizationCard exactly: informational-only,
        // unconditional (every organization sees this same message today -
        // it reflects real equipment, not a feature flag), never presented
        // as a mobile-specific limitation.
        Text(text = "Battery Optimization", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 4.dp))
        Text(
            text = "This plant has no battery storage installed.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
