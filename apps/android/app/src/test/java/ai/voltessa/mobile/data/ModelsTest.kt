package ai.voltessa.mobile.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the Kotlin models decode the ACTUAL Voltessa Mobile API response
 * shapes (M0/M1) - these JSON fixtures are copied from the real Route
 * Handlers' response construction under apps/web/app/api, not invented.
 */
class ModelsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `decodes a sign-in success response`() {
        val body = """
            {
              "sessionToken": "abc-123",
              "expires": "2026-09-25T00:00:00.000Z",
              "user": {
                "id": "user_1",
                "name": "Test User",
                "email": "test@example.com",
                "role": "OWNER",
                "organizationId": "org_1",
                "organization": { "id": "org_1", "name": "Test Org" }
              }
            }
        """.trimIndent()

        val result = json.decodeFromString<SignInResponse>(body)

        assertEquals("abc-123", result.sessionToken)
        assertEquals("org_1", result.user.organizationId)
        assertEquals("Test Org", result.user.organization.name)
    }

    @Test
    fun `decodes a sign-in error response via ApiErrorBody`() {
        val body = """{"error":"invalid_credentials"}"""

        val result = json.decodeFromString<ApiErrorBody>(body)

        assertEquals("invalid_credentials", result.error)
    }

    @Test
    fun `decodes an empty plants list`() {
        val body = """{"plants":[]}"""

        val result = json.decodeFromString<PlantsResponse>(body)

        assertTrue(result.plants.isEmpty())
    }

    @Test
    fun `decodes a plants list with nullable fields absent`() {
        val body = """
            {"plants":[{"id":"p1","name":"Atlanta","capacityKw":null,"latitude":null,"longitude":null}]}
        """.trimIndent()

        val result = json.decodeFromString<PlantsResponse>(body)

        assertEquals(1, result.plants.size)
        assertEquals("Atlanta", result.plants[0].name)
        assertNull(result.plants[0].capacityKw)
    }

    @Test
    fun `decodes a plant connection response`() {
        val connected = json.decodeFromString<PlantConnectionResponse>(
            """{"connected":true,"provider":"Huawei"}""",
        )
        assertTrue(connected.connected)
        assertEquals("Huawei", connected.provider)

        val notConnected = json.decodeFromString<PlantConnectionResponse>(
            """{"connected":false,"provider":null}""",
        )
        assertFalse(notConnected.connected)
        assertNull(notConnected.provider)
    }

    @Test
    fun `decodes a dashboard response ignoring fields this client does not model`() {
        val body = """
            {
              "plantAvailable": true,
              "plantName": "Atlanta",
              "chartUnit": "kW",
              "latestTelemetryAt": "2026-08-27T10:00:00.000Z",
              "kpis": {
                "producedTodayKwh": 12.5,
                "totalYieldKwh": 4000.0,
                "consumedTodayKwh": 8.1,
                "consumedFromPvKwh": 6.0,
                "exportedTodayKwh": 4.4,
                "importedTodayKwh": 2.1,
                "revenue": { "amount": 1.23, "currency": "EUR" }
              },
              "chartSeries": [],
              "energyFlow": {},
              "inverters": {},
              "market": {},
              "eventLog": [],
              "weather": null,
              "forecastSummary": null,
              "period": "today",
              "selectedDate": "2026-08-27",
              "isToday": true,
              "prevDateParam": "2026-08-26",
              "nextDateParam": "2026-08-28",
              "periodRangeLabel": "Today"
            }
        """.trimIndent()

        val result = json.decodeFromString<DashboardResponse>(body)

        assertTrue(result.plantAvailable)
        assertEquals("Atlanta", result.plantName)
        assertEquals(12.5, result.kpis?.producedTodayKwh)
    }

    @Test
    fun `decodes chartSeries, weather, and market fields from a real dashboard shape`() {
        val body = """
            {
              "plantAvailable": true,
              "plantName": "Atlanta",
              "chartUnit": "kW",
              "latestTelemetryAt": "2026-08-27T10:00:00.000Z",
              "kpis": { "producedTodayKwh": 12.5 },
              "chartSeries": [
                { "time": 1735300000000, "pvKw": 3.2, "consumptionKw": 1.1, "gridImportKw": null, "gridExportKw": 2.1, "forecastPvKw": null },
                { "time": 1735300900000, "pvKw": null, "consumptionKw": null, "gridImportKw": null, "gridExportKw": null, "forecastPvKw": 3.4 }
              ],
              "weather": {
                "current": { "irradiance": 450.0, "cloudCover": 20.0, "temperature": 24.5, "windSpeed": 3.1, "weatherCode": 1 },
                "hourly": []
              },
              "market": {
                "currentPrice": { "value": 0.18, "currency": "EUR", "intervalLabel": "14:00-14:15", "deltaVsPrevious": -0.02 },
                "exportRecommended": true,
                "threshold": { "minimumExportPrice": 15, "currency": "EUR" }
              },
              "period": "today",
              "selectedDate": "2026-08-27",
              "isToday": true,
              "prevDateParam": "2026-08-26",
              "nextDateParam": "2026-08-28",
              "periodRangeLabel": "Today"
            }
        """.trimIndent()

        val result = json.decodeFromString<DashboardResponse>(body)

        assertEquals(2, result.chartSeries.size)
        assertEquals(3.2, result.chartSeries[0].pvKw)
        assertNull(result.chartSeries[0].gridImportKw)
        assertEquals(3.4, result.chartSeries[1].forecastPvKw)

        assertEquals(20.0, result.weather?.current?.cloudCover)
        assertEquals(1, result.weather?.current?.weatherCode)

        assertEquals(0.18, result.market?.currentPrice?.value)
        assertEquals("EUR", result.market?.currentPrice?.currency)
        assertTrue(result.market?.exportRecommended == true)
        assertEquals(15.0, result.market?.threshold?.minimumExportPrice)
    }

    @Test
    fun `decodes a plant-unavailable dashboard response`() {
        val body = """
            {
              "plantAvailable": false,
              "period": "today",
              "selectedDate": "2026-08-27",
              "isToday": true,
              "prevDateParam": "2026-08-26",
              "nextDateParam": "2026-08-28",
              "periodRangeLabel": "Today"
            }
        """.trimIndent()

        val result = json.decodeFromString<DashboardResponse>(body)

        assertFalse(result.plantAvailable)
        assertNull(result.plantName)
    }
}
