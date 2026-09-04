package ai.voltessa.mobile.data

/** Wraps the three plant-scoped Mobile API read endpoints (M0, ADR-020). */
class PlantsRepository(private val apiClient: ApiClient) {
    suspend fun listPlants(): ApiResult<PlantsResponse> = apiClient.get("/api/plants")

    suspend fun getConnection(plantId: String): ApiResult<PlantConnectionResponse> =
        apiClient.get("/api/plants/$plantId/connection")

    suspend fun getDashboard(plantId: String): ApiResult<DashboardResponse> =
        apiClient.get("/api/plants/$plantId/dashboard")
}
