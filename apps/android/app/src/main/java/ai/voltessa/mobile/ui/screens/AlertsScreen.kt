package ai.voltessa.mobile.ui.screens

import ai.voltessa.mobile.ui.components.SectionHeader
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Mobile Redesign milestone - visual-language-only pass. Still no real
 * backend (see apps/web/app/[locale]/(platform)/alerts/page.tsx - itself
 * one static line of copy), so this remains the same honest message, only
 * re-styled to match the rest of the app.
 */
@Composable
fun AlertsScreen() {
    Column(modifier = Modifier.fillMaxSize().padding(20.dp)) {
        SectionHeader(title = "Alerts")
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "Review operational alerts and important platform events.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
