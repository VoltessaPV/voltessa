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
 * M4 - BESS has no real backend today: confirmed by direct inspection of
 * apps/web/app/[locale]/(platform)/bess/page.tsx, which is itself a static
 * placeholder (no battery Prisma model, no vendor integration, no Server
 * Action, no API route anywhere in the codebase). This screen mirrors
 * that exact same real, deployed Web state instead of fabricating battery
 * data or a fake control surface - see the M4 report for the backend gap
 * this represents (a battery/BESS data model + vendor integration would be
 * required before this can become a real mobile section, not a schema
 * change to make casually here).
 */
@Composable
fun BessScreen() {
    Column(modifier = Modifier.fillMaxSize().padding(24.dp)) {
        Text(text = "Battery Energy Storage System", style = MaterialTheme.typography.headlineSmall)
        Text(
            text = "No battery storage system configured. Battery optimization and energy storage features become available after connecting a supported battery.",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 16.dp),
        )
    }
}
