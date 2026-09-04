package ai.voltessa.mobile.ui.screens

import ai.voltessa.mobile.data.CurrentUserDto
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * M4 - real account info (from /api/me, already fetched at login/session
 * restore - no new call needed) plus Sign out. Password change and other
 * Web-only settings (billing, energy market, notification preferences,
 * account deletion) are deliberately not duplicated here yet - see the M4
 * report for exactly why each one is out of scope this round.
 */
@Composable
fun SettingsScreen(
    user: CurrentUserDto,
    onLogout: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize().padding(24.dp)) {
        Text(text = "Account", style = MaterialTheme.typography.titleMedium)
        Text(text = user.name ?: user.email, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp))
        Text(text = user.email, style = MaterialTheme.typography.bodyMedium)
        Text(text = "Role: ${user.role}", style = MaterialTheme.typography.bodyMedium)
        Text(text = "Organization: ${user.organization.name}", style = MaterialTheme.typography.bodyMedium)

        HorizontalDivider(modifier = Modifier.padding(vertical = 24.dp))

        OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth()) {
            Text("Sign out")
        }
    }
}
