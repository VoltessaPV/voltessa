package ai.voltessa.mobile.ui.components

/**
 * Mirrors Web's own `solarCondition`/`cloudCoverCondition`/
 * `weatherCodeOverride` (components/dashboard/WeatherCard.tsx) exactly -
 * same thresholds, same WMO code groupings, same English labels (see
 * messages/en/dashboard.json's `weather.conditions`) - so Mobile's
 * dashboard shows the identical condition a Web user would see for the
 * same reading, per M3's "dashboard parity" goal. Not a new weather
 * interpretation invented for mobile.
 */
private val SEVERE_WEATHER_CODES = setOf(95, 96, 99)
private val SNOW_WEATHER_CODES = setOf(71, 73, 75, 77, 85, 86)
private val SHOWER_WEATHER_CODES = setOf(80, 81, 82)
private val RAIN_WEATHER_CODES = setOf(51, 53, 55, 56, 57, 61, 63, 65, 66, 67)
private val FOG_WEATHER_CODES = setOf(45, 48)

private fun weatherCodeOverride(weatherCode: Int): String? = when {
    SEVERE_WEATHER_CODES.contains(weatherCode) -> "Thunderstorm"
    SNOW_WEATHER_CODES.contains(weatherCode) -> "Snow"
    SHOWER_WEATHER_CODES.contains(weatherCode) -> "Showers"
    RAIN_WEATHER_CODES.contains(weatherCode) -> "Rain"
    FOG_WEATHER_CODES.contains(weatherCode) -> "Fog"
    else -> null
}

private fun cloudCoverCondition(cloudCoverPercent: Double): String = when {
    cloudCoverPercent <= 15 -> "Clear"
    cloudCoverPercent <= 40 -> "Mostly Clear"
    cloudCoverPercent <= 70 -> "Partly Cloudy"
    cloudCoverPercent <= 90 -> "Cloudy"
    else -> "Overcast"
}

fun solarConditionLabel(cloudCoverPercent: Double, weatherCode: Int): String =
    weatherCodeOverride(weatherCode) ?: cloudCoverCondition(cloudCoverPercent)
