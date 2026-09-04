package ai.voltessa.mobile.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Production Mobile/Web Parity milestone. One generic, reusable time-series
 * line chart, purpose-built for a 360-430px phone screen - replaces the
 * old EnergyFlowChart's bespoke, axis-less Canvas drawing (kept as a plain
 * Compose Canvas, no new charting-library dependency, per the existing
 * convention this app already established) and is now also used by the
 * Market price/export chart, so the two screens share one implementation
 * instead of two parallel ones.
 *
 * All lines share one x-axis (`times`, epoch-millisecond, ascending) - the
 * caller is responsible for building parallel `values` lists already
 * aligned to that same axis (both `DashboardResponse.chartSeries` and
 * `MarketPageResponse.series` are already one row per grid interval
 * server-side, so this is a direct map, never a resample).
 *
 * Deliberately simple by mobile standards (Step 9 of the Mobile/Web Parity
 * audit): a zero baseline (so negative values - real for market prices -
 * read correctly), min/max value labels as plain Compose Text (not drawn
 * inside the Canvas, so there's no manual text-measurement/centering to get
 * wrong), 4 evenly-spaced x-axis time labels below the chart, and a
 * tap-to-inspect gesture that shows the nearest point's exact time/values
 * as a line of text under the chart - simpler and more reliably readable on
 * a small screen than an in-canvas floating tooltip, and a plain tap (not a
 * tracked drag) never competes with the screen's own vertical scroll.
 */
data class ChartLine(
    val label: String,
    val color: Color,
    val values: List<Double?>,
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TimeSeriesLineChart(
    times: List<Long>,
    lines: List<ChartLine>,
    modifier: Modifier = Modifier,
    valueFormatter: (Double) -> String = { formatCompactNumber(it) },
    timeZoneId: String = "Europe/Sofia",
    chartHeight: androidx.compose.ui.unit.Dp = 180.dp,
    /** Optional dashed horizontal line (e.g. Market's export threshold) - drawn under the data lines so a price line crossing it stays fully visible. */
    referenceLine: Double? = null,
) {
    if (times.isEmpty() || lines.all { line -> line.values.all { it == null } }) {
        Text(
            text = "No chart data available for this period.",
            style = MaterialTheme.typography.bodyMedium,
        )
        return
    }

    val zoneId = remember(timeZoneId) { ZoneId.of(timeZoneId) }
    val timeFormatter = remember { DateTimeFormatter.ofPattern("HH:mm") }

    val allValues = lines.flatMap { it.values }.filterNotNull() + listOfNotNull(referenceLine)
    val maxValue = maxOf(allValues.maxOrNull() ?: 0.0, 0.0)
    val minValue = minOf(allValues.minOrNull() ?: 0.0, 0.0)
    val valueRange = (maxValue - minValue).let { if (it < 0.0001) 1.0 else it }

    val minTime = times.first()
    val maxTime = times.last()
    val timeRange = (maxTime - minTime).let { if (it <= 0L) 1L else it }

    var selectedIndex by remember(times, lines) { mutableStateOf<Int?>(null) }

    fun nearestIndexForFraction(fraction: Float): Int {
        val target = minTime + (timeRange * fraction.toDouble()).toLong()
        var bestIndex = 0
        var bestDelta = Long.MAX_VALUE
        times.forEachIndexed { index, time ->
            val delta = kotlin.math.abs(time - target)
            if (delta < bestDelta) {
                bestDelta = delta
                bestIndex = index
            }
        }
        return bestIndex
    }

    Column(modifier = modifier.fillMaxWidth()) {
        // Legend - one dot + label per line. FlowRow (not Row - a plain Row
        // never wraps, it silently overflows past the screen edge) so a
        // 2-series legend (Production/Consumption) still fits at 360dp,
        // including at a larger accessibility font scale.
        FlowRow(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            lines.forEach { line ->
                Row {
                    LegendDot(line.color)
                    Text(text = line.label, style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        Box(modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(chartHeight)
                    // Tap-to-inspect, not press-and-drag: a drag gesture here
                    // would have to consume move events to track the finger,
                    // which steals the gesture from the screen's own
                    // verticalScroll (a swipe starting on the chart would
                    // freeze page scrolling). A single tap never competes
                    // with scroll-gesture recognition, so this can never
                    // break scrolling.
                    .pointerInput(times.size, lines.size) {
                        detectTapGestures { offset ->
                            selectedIndex = nearestIndexForFraction((offset.x / size.width).coerceIn(0f, 1f))
                        }
                    },
            ) {
                val width = size.width
                val height = size.height

                fun xFor(time: Long) = ((time - minTime).toFloat() / timeRange) * width
                fun yFor(value: Double) = ((maxValue - value) / valueRange).toFloat() * height

                // Zero baseline - only meaningful (and only drawn) when the
                // data actually straddles zero, e.g. a day with negative
                // market prices.
                if (minValue < 0.0 && maxValue > 0.0) {
                    val zeroY = yFor(0.0)
                    drawLine(
                        color = Color.White.copy(alpha = 0.25f),
                        start = Offset(0f, zeroY),
                        end = Offset(width, zeroY),
                        strokeWidth = 1.5f,
                    )
                }

                referenceLine?.let { threshold ->
                    val y = yFor(threshold)
                    drawLine(
                        color = Color.White.copy(alpha = 0.35f),
                        start = Offset(0f, y),
                        end = Offset(width, y),
                        strokeWidth = 2f,
                        pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(10f, 8f)),
                    )
                }

                lines.forEach { line ->
                    var previous: Offset? = null
                    times.forEachIndexed { index, time ->
                        val value = line.values.getOrNull(index)
                        if (value == null) {
                            previous = null
                            return@forEachIndexed
                        }
                        val point = Offset(xFor(time), yFor(value))
                        previous?.let {
                            drawLine(color = line.color, start = it, end = point, strokeWidth = 4f)
                        }
                        previous = point
                    }
                }

                selectedIndex?.let { index ->
                    val time = times.getOrNull(index) ?: return@let
                    val x = xFor(time)
                    drawLine(
                        color = Color.White.copy(alpha = 0.45f),
                        start = Offset(x, 0f),
                        end = Offset(x, height),
                        strokeWidth = 2f,
                    )
                }
            }

            Text(
                text = valueFormatter(maxValue),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.TopStart).padding(2.dp),
            )
            Text(
                text = valueFormatter(minValue),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.BottomStart).padding(2.dp),
            )
        }

        // X-axis - 4 evenly-spaced time labels, always the real first/last
        // grid times at the ends so the visible range is never ambiguous.
        Row(modifier = Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            val tickCount = 4
            for (tick in 0..tickCount) {
                val time = minTime + (timeRange * tick / tickCount)
                val label = Instant.ofEpochMilli(time).atZone(zoneId).format(timeFormatter)
                Text(text = label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        selectedIndex?.let { index ->
            val time = times.getOrNull(index)
            if (time != null) {
                val timeLabel = Instant.ofEpochMilli(time).atZone(zoneId).format(timeFormatter)
                val parts = lines.joinToString("  ·  ") { line ->
                    val value = line.values.getOrNull(index)
                    "${line.label}: ${value?.let { valueFormatter(it) } ?: "—"}"
                }
                Text(
                    text = "$timeLabel  ·  $parts",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}

/** Compact, locale-independent number formatting for chart axis labels - avoids `String.format`'s default-locale decimal separator surprising a user whose device locale uses a comma. */
fun formatCompactNumber(value: Double): String {
    val rounded = kotlin.math.round(value * 10) / 10.0
    return if (rounded == rounded.toLong().toDouble()) {
        rounded.toLong().toString()
    } else {
        val negative = rounded < 0
        val absValue = kotlin.math.abs(rounded)
        val whole = absValue.toLong()
        val fraction = kotlin.math.round((absValue - whole) * 10).toLong()
        "${if (negative) "-" else ""}$whole.$fraction"
    }
}

@Composable
private fun LegendDot(color: Color) {
    Canvas(modifier = Modifier.size(10.dp).padding(end = 4.dp)) {
        drawCircle(color = color)
    }
}
