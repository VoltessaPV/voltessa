package ai.voltessa.mobile.data

import kotlinx.serialization.encodeToString

/** Wraps the new M4 Mobile Automation Settings endpoint (organization-scoped, not plant-scoped). */
class AutomationsRepository(private val apiClient: ApiClient) {
    suspend fun getSettings(): ApiResult<AutomationSettingsResponse> =
        apiClient.get("/api/automation-settings")

    suspend fun updateSettings(
        enabled: Boolean,
        minimumExportPrice: String,
        enabledDays: List<String>,
    ): ApiResult<UpdateAutomationSettingsResponse> {
        val bodyJson = apiClient.json.encodeToString(
            UpdateAutomationSettingsRequest(enabled, minimumExportPrice, enabledDays),
        )
        return apiClient.postJsonAuthenticated("/api/automation-settings", bodyJson)
    }
}
