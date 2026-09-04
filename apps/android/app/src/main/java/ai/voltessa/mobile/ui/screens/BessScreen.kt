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
 * backend (see apps/web/app/[locale]/(platform)/bess/page.tsx - itself a
 * static placeholder), so this remains the same honest "not available yet"
 * message, only re-styled to match the rest of the app instead of a bare
 * `headlineSmall` + paragraph.
 */
@Composable
fun BessScreen() {
    Column(modifier = Modifier.fillMaxSize().padding(20.dp)) {
        SectionHeader(title = "Battery Energy Storage System")
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "No battery storage system configured. Battery optimization and energy storage features become available after connecting a supported battery.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
