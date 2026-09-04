package ai.voltessa.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

/**
 * Never logs the entered password anywhere in this composable or its
 * callers (M2 requirement #8) - it only ever leaves this screen as an
 * in-memory String passed straight to `AppViewModel.login`, which hands it
 * to `AuthRepository.signIn`, which hands it to the request body.
 *
 * M5: "Continue with Google" is prominent and first, matching Web's own
 * `LoginForm.tsx` layout (Google button, then an "or" divider, then the
 * email/password form) - not a redesign, the same order Web already uses.
 * `onGoogleSignIn` triggers the actual Credential Manager flow, owned by
 * the caller (MainActivity) since it needs an Activity context this
 * screen doesn't have.
 */
@Composable
fun LoginScreen(
    isBusy: Boolean,
    errorMessage: String?,
    onLogin: (email: String, password: String) -> Unit,
    onGoogleSignIn: () -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(text = "Voltessa", style = MaterialTheme.typography.headlineMedium)
        Text(text = "Sign in", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp, bottom = 24.dp))

        OutlinedButton(
            onClick = onGoogleSignIn,
            enabled = !isBusy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Continue with Google")
        }

        Column(modifier = Modifier.fillMaxWidth().padding(vertical = 20.dp)) {
            HorizontalDivider()
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text(
                    text = "or",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
            }
            HorizontalDivider()
        }

        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("Email") },
            singleLine = true,
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        )

        if (errorMessage != null) {
            Text(
                text = errorMessage,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 12.dp),
            )
        }

        Button(
            onClick = { onLogin(email.trim(), password) },
            enabled = !isBusy,
            modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
        ) {
            if (isBusy) {
                CircularProgressIndicator(modifier = Modifier.padding(4.dp).height(20.dp))
            } else {
                Text("Sign in")
            }
        }
    }
}
