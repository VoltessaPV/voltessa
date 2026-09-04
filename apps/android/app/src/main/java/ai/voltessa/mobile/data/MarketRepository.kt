package ai.voltessa.mobile.data

/** Wraps the new M4 Mobile Market endpoint. */
class MarketRepository(private val apiClient: ApiClient) {
    suspend fun getMarket(plantId: String): ApiResult<MarketPageResponse> =
        apiClient.get("/api/plants/$plantId/market")
}
