package ai.voltessa.mobile.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * M4 - Alerts has no real backend today: confirmed by direct inspection
 * of apps/web/app/[locale]/(platform)/alerts/page.tsx, which renders
 * exactly one static line of copy - no Alert Prisma model, no list query,
 * no acknowledge/resolve action anywhere in the codebase. This screen
 * mirrors that exact same real, deployed Web copy rather than fabricating
 * an alert list - see the M4 report for the backend gap this represents
 * (an Alert data model + generation logic would be required first).
 */
@Composable
fun AlertsScreen() {
    Column(modifier = Modifier.fillMaxSize().padding(24.dp)) {
        Text(
            text = "Review operational alerts and important platform events.",
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}
