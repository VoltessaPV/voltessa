package ai.voltessa.mobile.data

import kotlinx.serialization.encodeToString

/**
 * Wraps the two Mobile auth endpoints (M0/M1, ADR-020) plus /api/me, and
 * owns the local `TokenStore`. Mobile's session is entirely independent
 * from Web's cookie session - sign-in never touches a cookie (the server
 * never sets one for this endpoint), and sign-out only ever revokes the
 * one Session row this app's own token names (see api-session.ts's
 * `revokeApiSession` on the server side).
 */
class AuthRepository(
    private val apiClient: ApiClient,
    private val tokenStore: TokenStore,
) {
    fun hasStoredToken(): Boolean = tokenStore.getToken() != null

    suspend fun signIn(email: String, password: String): ApiResult<SignInResponse> {
        val bodyJson = apiClient.json.encodeToString<SignInRequest>(SignInRequest(email, password))
        val result = apiClient.postJson<SignInResponse>("/api/auth/mobile/sign-in", bodyJson)

        if (result is ApiResult.Success) {
            tokenStore.saveToken(result.data.sessionToken)
        }

        return result
    }

    /**
     * M5 - `idToken` comes from Android's Credential Manager / Sign in
     * with Google (see `ui/GoogleSignIn.kt`), never a manually-implemented
     * OAuth flow. Same response shape and token-storage behavior as
     * `signIn` above - the server-side `/google-sign-in` route mints an
     * identical Bearer session via the same shared
     * `mintMobileSessionForUser`.
     */
    suspend fun signInWithGoogle(idToken: String): ApiResult<SignInResponse> {
        val bodyJson = apiClient.json.encodeToString<GoogleSignInRequest>(GoogleSignInRequest(idToken))
        val result = apiClient.postJson<SignInResponse>("/api/auth/mobile/google-sign-in", bodyJson)

        if (result is ApiResult.Success) {
            tokenStore.saveToken(result.data.sessionToken)
        }

        return result
    }

    /** Always clears the local token, even if the server call fails (network error) - a locally-forgotten token is never usable again from this device either way. */
    suspend fun signOut(): ApiResult<Unit> {
        val result = apiClient.postAuthenticated<SignOutResponse>("/api/auth/mobile/sign-out")
        tokenStore.clear()
        return when (result) {
            is ApiResult.Success -> ApiResult.Success(Unit)
            is ApiResult.HttpError -> ApiResult.HttpError(result.statusCode, result.errorCode)
            is ApiResult.NetworkError -> ApiResult.NetworkError
        }
    }

    suspend fun getCurrentUser(): ApiResult<CurrentUserDto> = apiClient.get("/api/me")
}

@kotlinx.serialization.Serializable
private data class SignOutResponse(val ok: Boolean)
