package ai.voltessa.mobile.data

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/**
 * Typed outcome of any API call - deliberately has no "raw exception"
 * branch that could reach the UI (M2 requirement #7): every failure is
 * either a structured HTTP error (status code + the server's own JSON
 * `error` code, when present) or a generic network failure, never a stack
 * trace or exception message shown to the user.
 */
sealed class ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>()

    /** `errorCode` is the backend's own machine-readable `error` field (e.g. "invalid_credentials"), when the body parsed as one - never the raw body text. */
    data class HttpError(val statusCode: Int, val errorCode: String?) : ApiResult<Nothing>()
    data object NetworkError : ApiResult<Nothing>()
}

/**
 * Thin OkHttp + kotlinx.serialization wrapper for Voltessa's Mobile API
 * (M0/M1, ADR-020). Never logs request/response bodies, headers, or the
 * Authorization header anywhere - no Log.d/Log.e/println call exists in
 * this file or its callers (M2 requirement #8). HTTPS-only by construction:
 * `ApiConfig.BASE_URL` is a fixed `https://` URL and the manifest disables
 * cleartext traffic entirely.
 */
class ApiClient(@PublishedApi internal val tokenStore: TokenStore) {
    val json: Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    // @PublishedApi internal (not private): the public inline fun/get/post
    // functions below reference these directly, and an inline function's
    // body is copied to call sites - Kotlin requires anything it touches to
    // be at least as visible as "internal + published", not private.
    @PublishedApi
    internal val httpClient = OkHttpClient.Builder().build()

    @PublishedApi
    internal val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    /** POST with a pre-serialized JSON body - used by sign-in, which is unauthenticated. */
    suspend inline fun <reified TResponse> postJson(
        path: String,
        bodyJson: String,
    ): ApiResult<TResponse> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url(ApiConfig.BASE_URL + path)
                .post(bodyJson.toRequestBody(jsonMediaType))
                .build()

            httpClient.newCall(request).execute().use { response -> parseResponse(response) }
        } catch (_: IOException) {
            ApiResult.NetworkError
        }
    }

    /** POST with no body, Bearer-authenticated - used by sign-out. */
    suspend inline fun <reified TResponse> postAuthenticated(path: String): ApiResult<TResponse> =
        withContext(Dispatchers.IO) {
            try {
                val requestBuilder = Request.Builder()
                    .url(ApiConfig.BASE_URL + path)
                    .post("{}".toRequestBody(jsonMediaType))

                tokenStore.getToken()?.let { requestBuilder.addHeader("Authorization", "Bearer $it") }

                httpClient.newCall(requestBuilder.build()).execute().use { response -> parseResponse(response) }
            } catch (_: IOException) {
                ApiResult.NetworkError
            }
        }

    /** POST with a pre-serialized JSON body, Bearer-authenticated - M4, used by the Automations save action. */
    suspend inline fun <reified TResponse> postJsonAuthenticated(
        path: String,
        bodyJson: String,
    ): ApiResult<TResponse> = withContext(Dispatchers.IO) {
        try {
            val requestBuilder = Request.Builder()
                .url(ApiConfig.BASE_URL + path)
                .post(bodyJson.toRequestBody(jsonMediaType))

            tokenStore.getToken()?.let { requestBuilder.addHeader("Authorization", "Bearer $it") }

            httpClient.newCall(requestBuilder.build()).execute().use { response -> parseResponse(response) }
        } catch (_: IOException) {
            ApiResult.NetworkError
        }
    }

    /** GET, Bearer-authenticated - used by every read endpoint (/api/me, /api/plants, ...). */
    suspend inline fun <reified TResponse> get(path: String): ApiResult<TResponse> =
        withContext(Dispatchers.IO) {
            try {
                val requestBuilder = Request.Builder().url(ApiConfig.BASE_URL + path)

                tokenStore.getToken()?.let { requestBuilder.addHeader("Authorization", "Bearer $it") }

                httpClient.newCall(requestBuilder.build()).execute().use { response -> parseResponse(response) }
            } catch (_: IOException) {
                ApiResult.NetworkError
            }
        }

    inline fun <reified TResponse> parseResponse(response: Response): ApiResult<TResponse> {
        val bodyString = response.body?.string().orEmpty()

        if (!response.isSuccessful) {
            val errorCode = try {
                json.decodeFromString<ApiErrorBody>(bodyString).error
            } catch (_: SerializationException) {
                null
            }
            return ApiResult.HttpError(response.code, errorCode)
        }

        return try {
            ApiResult.Success(json.decodeFromString<TResponse>(bodyString))
        } catch (_: SerializationException) {
            ApiResult.HttpError(response.code, null)
        }
    }
}
