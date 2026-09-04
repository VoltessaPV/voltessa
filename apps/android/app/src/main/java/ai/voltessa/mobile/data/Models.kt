package ai.voltessa.mobile.data

import kotlinx.serialization.Serializable

/**
 * Response models for Voltessa's Mobile API (M0/M1, ADR-020). Field names
 * and shapes are taken directly from the actual Route Handlers under
 * apps/web/app/api - nothing here is invented. Every model uses
 * kotlinx.serialization's default lenient/ignore-unknown-keys decoding
 * (see ApiClient.json), so a field this client doesn't declare is simply
 * skipped, never an error - this app deliberately surfaces only a subset
 * of GET /api/plants/:plantId/dashboard's full response for its first
 * version (see DashboardResponse below).
 */

@Serializable
data class ApiErrorBody(
    val error: String? = null,
)

// POST /api/auth/mobile/sign-in

@Serializable
data class SignInRequest(
    val email: String,
    val password: String,
)

@Serializable
data class SignInResponse(
    val sessionToken: String,
    val expires: String,
    val user: CurrentUserDto,
)

// POST /api/auth/mobile/google-sign-in (M5) - same success response shape
// as SignInResponse above, reused verbatim server-side.
@Serializable
data class GoogleSignInRequest(
    val idToken: String,
)

// GET /api/me and the `user` object embedded in SignInResponse - identical
// shape, one Kotlin type for both.
@Serializable
data class CurrentUserDto(
    val id: String,
    val name: String? = null,
    val email: String,
    val role: String,
    val organizationId: String,
    val organization: OrganizationDto,
)

@Serializable
data class OrganizationDto(
    val id: String,
    val name: String,
)

// GET /api/plants

@Serializable
data class PlantsResponse(
    val plants: List<PlantDto>,
)

@Serializable
data class PlantDto(
    val id: String,
    val name: String,
    val capacityKw: Double? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
)

// GET /api/plants/:plantId/connection

@Serializable
data class PlantConnectionResponse(
    val connected: Boolean,
    val provider: String? = null,
)

// GET /api/plants/:plantId/dashboard
//
// The real response (DashboardPageData, apps/web/app/[locale]/(platform)/
// dashboard/dashboard-data.ts) is larger still than what's modeled here
// (forecastSummary, eventLog, inverters, previousPeriodKpis, energyFlow
// live-snapshot, revenue detail, ...) - this remains a deliberate subset,
// not the full contract, but M3 extends it to cover chartSeries/weather/
// market on top of M2's plantName/kpis/chartUnit/latestTelemetryAt. Every
// field below is a real field of that same, unchanged response - nothing
// invented, no new backend endpoint.
@Serializable
data class DashboardResponse(
    val plantAvailable: Boolean,
    val plantName: String? = null,
    val chartUnit: String? = null,
    val latestTelemetryAt: String? = null,
    val kpis: DashboardKpisDto? = null,
    val chartSeries: List<EnergyFlowPointDto> = emptyList(),
    val weather: SolarWeatherDto? = null,
    val market: DashboardMarketWidgetDto? = null,
)

@Serializable
data class DashboardKpisDto(
    val producedTodayKwh: Double? = null,
    val totalYieldKwh: Double? = null,
    val consumedTodayKwh: Double? = null,
    val consumedFromPvKwh: Double? = null,
    val exportedTodayKwh: Double? = null,
    val importedTodayKwh: Double? = null,
)

/** One point of `DashboardPageData.chartSeries` (dashboard-data.ts's `EnergyFlowPoint`). `time` is an epoch-millisecond timestamp, matching `point.timestamp.getTime()` server-side. */
@Serializable
data class EnergyFlowPointDto(
    val time: Long,
    val pvKw: Double? = null,
    val consumptionKw: Double? = null,
    val gridImportKw: Double? = null,
    val gridExportKw: Double? = null,
    val forecastPvKw: Double? = null,
)

/** `DashboardPageData.weather` (lib/weather/openMeteo.ts's `SolarWeather`) - only `current` is modeled for M3's single weather card; `hourly` is left unparsed (ignored by `ignoreUnknownKeys`). */
@Serializable
data class SolarWeatherDto(
    val current: SolarWeatherCurrentDto,
)

@Serializable
data class SolarWeatherCurrentDto(
    val irradiance: Double,
    val cloudCover: Double,
    val temperature: Double,
    val windSpeed: Double,
    val weatherCode: Int,
)

/** `DashboardPageData.market` (dashboard-data.ts's `DashboardMarketWidgetData`). */
@Serializable
data class DashboardMarketWidgetDto(
    val currentPrice: MarketPriceDto? = null,
    val exportRecommended: Boolean? = null,
    val threshold: ExportThresholdDto? = null,
)

@Serializable
data class MarketPriceDto(
    val value: Double,
    val currency: String,
    val intervalLabel: String,
    val deltaVsPrevious: Double,
    // Only ever populated on Market's own `summary.currentPrice` (market-data.ts's
    // `MarketSummaryData.currentPrice.exportRecommended`, read from the same
    // `isExportRecommended(price, threshold)` result already computed into that
    // interval's `series` point - never recomputed here). Dashboard's
    // `market.currentPrice` doesn't nest this field (its `exportRecommended` is a
    // sibling of `currentPrice` on `DashboardMarketWidgetDto` instead), so it
    // decodes as null there - harmless, since this DTO is shared by both.
    val exportRecommended: Boolean? = null,
)

@Serializable
data class ExportThresholdDto(
    val minimumExportPrice: Double,
    val currency: String,
)

// GET /api/plants/:plantId/market (M4, extended by the Mobile/Web Parity
// milestone) - market-data.ts's `MarketPageResult` plus `currentExportMode`
// (see that route's own doc comment for where the latter comes from).
// `series` (the real per-interval price points already returned by this
// endpoint) is now modeled too, so the Mobile Market chart plots the exact
// same data Web's Price & Export chart does - `previousPeriodSeries` stays
// unparsed, since Mobile Market only ever shows "today" (no
// week/month/year period switcher yet).
@Serializable
data class MarketPageResponse(
    val dataAvailable: Boolean,
    val threshold: ExportThresholdDto? = null,
    val summary: MarketSummaryDto? = null,
    val distribution: List<DistributionBucketDto> = emptyList(),
    val eventLog: List<MarketEventLogEntryDto> = emptyList(),
    val isPartialImport: Boolean = false,
    val periodRangeLabel: String? = null,
    val series: List<MarketPricePointDto> = emptyList(),
    val insights: List<MarketInsightDto> = emptyList(),
    val currentExportMode: String? = null,
    val revenue: RevenueSummaryDto? = null,
)

/**
 * `RevenueSummary` (lib/market-price/revenue.ts's `computeExportRevenue`) - the
 * exact same meter-then-production-fallback revenue calculation Web's Market
 * page already displays, reused verbatim server-side (see that route's own
 * doc comment). `available: false` means no priced export interval existed
 * for today (e.g. a brand-new connection); the three value fields are only
 * ever populated together, when `available` is true.
 */
@Serializable
data class RevenueSummaryDto(
    val available: Boolean,
    val revenueEur: Double? = null,
    val exportedKwh: Double? = null,
    val averagePriceEurPerMwh: Double? = null,
)

/** `MarketPageResult.insights` (market-data.ts's `MarketInsight`) - pre-formatted text (e.g. "Hours above threshold: 5 h"), not raw numbers, so Mobile never recomputes the underlying statistic itself. */
@Serializable
data class MarketInsightDto(
    val text: String,
    val tone: String,
)

/** One point of `MarketPageResult.series` (market-data.ts's `MarketPricePoint`). `timestamp` is an ISO-8601 instant string, matching `Date`'s default JSON serialization server-side. */
@Serializable
data class MarketPricePointDto(
    val timestamp: String,
    val price: Double? = null,
    val exportEnabled: Boolean = false,
)

@Serializable
data class MarketSummaryDto(
    val currentPrice: MarketPriceDto? = null,
    val nextInterval: NextIntervalDto? = null,
    val lowestToday: PriceExtremeDto? = null,
    val highestToday: PriceExtremeDto? = null,
    val marketStatus: MarketStatusDto? = null,
)

@Serializable
data class NextIntervalDto(
    val value: Double,
    val intervalLabel: String,
    val direction: String,
)

@Serializable
data class PriceExtremeDto(
    val value: Double,
    val intervalLabel: String,
)

@Serializable
data class MarketStatusDto(
    val country: String,
    val source: String,
    val healthy: Boolean,
)

@Serializable
data class DistributionBucketDto(
    val label: String,
    val rangeLabel: String,
    val percentage: Double,
)

@Serializable
data class MarketEventLogEntryDto(
    val timestamp: String,
    val type: String,
    val label: String,
    val detail: String? = null,
)

// GET/POST /api/automation-settings (M4) - keyed by organizationId, not
// plantId, matching the real AutomationSettings Prisma model.
@Serializable
data class AutomationSettingsResponse(
    val automationEnabled: Boolean,
    val minimumExportPrice: String? = null,
    val currency: String? = null,
    val enabledDays: List<String> = emptyList(),
)

@Serializable
data class UpdateAutomationSettingsRequest(
    val enabled: Boolean,
    val minimumExportPrice: String,
    val enabledDays: List<String>,
)

@Serializable
data class UpdateAutomationSettingsResponse(
    val ok: Boolean = false,
)
