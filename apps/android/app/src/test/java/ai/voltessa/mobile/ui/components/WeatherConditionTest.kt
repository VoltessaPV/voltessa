package ai.voltessa.mobile.ui.components

import org.junit.Assert.assertEquals
import org.junit.Test

/** Mirrors Web's WeatherCard.tsx thresholds/overrides exactly - see solarConditionLabel's own doc comment. */
class WeatherConditionTest {
    @Test
    fun `cloud cover drives the condition when no severe weather code applies`() {
        assertEquals("Clear", solarConditionLabel(cloudCoverPercent = 10.0, weatherCode = 0))
        assertEquals("Mostly Clear", solarConditionLabel(cloudCoverPercent = 30.0, weatherCode = 0))
        assertEquals("Partly Cloudy", solarConditionLabel(cloudCoverPercent = 60.0, weatherCode = 0))
        assertEquals("Cloudy", solarConditionLabel(cloudCoverPercent = 85.0, weatherCode = 0))
        assertEquals("Overcast", solarConditionLabel(cloudCoverPercent = 95.0, weatherCode = 0))
    }

    @Test
    fun `a severe weather code overrides cloud cover`() {
        assertEquals("Thunderstorm", solarConditionLabel(cloudCoverPercent = 5.0, weatherCode = 95))
        assertEquals("Snow", solarConditionLabel(cloudCoverPercent = 5.0, weatherCode = 71))
        assertEquals("Rain", solarConditionLabel(cloudCoverPercent = 5.0, weatherCode = 61))
        assertEquals("Showers", solarConditionLabel(cloudCoverPercent = 5.0, weatherCode = 80))
        assertEquals("Fog", solarConditionLabel(cloudCoverPercent = 5.0, weatherCode = 45))
    }
}
