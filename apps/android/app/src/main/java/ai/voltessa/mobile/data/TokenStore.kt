package ai.voltessa.mobile.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Secure on-device storage for the Mobile Bearer sessionToken (ADR-020).
 * Backed by Android Keystore via EncryptedSharedPreferences
 * (androidx.security-crypto) - the token is encrypted at rest, never
 * written as plain text. Never logs the stored/read value (see this
 * class's own callers - no Log.* call anywhere touches the token).
 */
class TokenStore(context: Context) {
    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            "voltessa_mobile_session",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun getToken(): String? = prefs.getString(KEY_SESSION_TOKEN, null)

    fun saveToken(token: String) {
        prefs.edit().putString(KEY_SESSION_TOKEN, token).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY_SESSION_TOKEN).apply()
    }

    private companion object {
        const val KEY_SESSION_TOKEN = "session_token"
    }
}
