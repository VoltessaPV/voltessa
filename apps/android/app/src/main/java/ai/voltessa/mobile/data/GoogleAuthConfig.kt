package ai.voltessa.mobile.data

/**
 * The Web application's existing Google OAuth Client ID
 * (`AUTH_GOOGLE_ID` in apps/web, `lib/auth/config.ts`'s `Google({...})`
 * provider) - reused unchanged, not a second OAuth client created for
 * mobile. This value is a public client identifier, not a secret (the
 * matching client SECRET stays server-side only and is never referenced
 * anywhere in this app) - Android's Credential Manager needs it as the
 * `serverClientId` so the ID token it returns is audience-scoped to the
 * same client Voltessa's backend already verifies against
 * (`lib/auth/verify-google-id-token.ts`).
 *
 * A separate "Android" OAuth client (package name + signing certificate
 * SHA-1) must also be registered in the same Google Cloud project before
 * sign-in will actually work on a device - see the M5 report for the
 * exact values to register. Nothing about that Android client ID is
 * referenced here or anywhere else in code; Google Play Services resolves
 * it automatically from this app's own package/signing certificate.
 */
object GoogleAuthConfig {
    const val WEB_CLIENT_ID: String = "274774778152-hegjj6khcfdirtm5t74ut4u5lus9ve4u.apps.googleusercontent.com"
}
