package ai.voltessa.mobile.ui

import ai.voltessa.mobile.data.GoogleAuthConfig
import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException

sealed class GoogleSignInOutcome {
    data class Success(val idToken: String) : GoogleSignInOutcome()
    data object Cancelled : GoogleSignInOutcome()
    data class Failed(val message: String) : GoogleSignInOutcome()
}

/**
 * M5 - the official Android Credential Manager / Sign in with Google flow,
 * triggered by an explicit "Continue with Google" button tap (never a
 * manually-implemented WebView OAuth exchange, per the milestone's own
 * requirement). `GetSignInWithGoogleOption` is Google's documented choice
 * for exactly this "explicit button" pattern - `GetGoogleIdOption` is the
 * alternative meant for a proactive/automatic "One Tap" prompt shown
 * without the user asking for it, which this app doesn't use.
 *
 * Returns only the raw Google ID token string - never anything else from
 * the credential - which `AuthRepository.signInWithGoogle` then hands to
 * the backend for verification (`lib/auth/verify-google-id-token.ts`).
 * Nothing here ever touches a client secret; Android OAuth clients have
 * none.
 *
 * `context` must be an Activity context - Credential Manager shows real
 * UI (the account picker) anchored to it.
 */
suspend fun requestGoogleIdToken(context: Context): GoogleSignInOutcome {
    val option = GetSignInWithGoogleOption.Builder(GoogleAuthConfig.WEB_CLIENT_ID).build()

    val request = GetCredentialRequest.Builder()
        .addCredentialOption(option)
        .build()

    return try {
        val credentialManager = CredentialManager.create(context)
        val response = credentialManager.getCredential(context, request)
        val credential = response.credential

        if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            return GoogleSignInOutcome.Failed("Unexpected response from Google Sign-In.")
        }

        val googleIdTokenCredential = GoogleIdTokenCredential.createFrom(credential.data)
        GoogleSignInOutcome.Success(googleIdTokenCredential.idToken)
    } catch (_: GetCredentialCancellationException) {
        GoogleSignInOutcome.Cancelled
    } catch (_: GetCredentialException) {
        GoogleSignInOutcome.Failed("Google Sign-In failed. Please try again.")
    } catch (_: GoogleIdTokenParsingException) {
        GoogleSignInOutcome.Failed("Google Sign-In failed. Please try again.")
    }
}
