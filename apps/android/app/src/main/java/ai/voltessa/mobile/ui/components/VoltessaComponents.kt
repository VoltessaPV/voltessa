package ai.voltessa.mobile.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Mobile Redesign milestone (VOLTESSA MOBILE - FINAL PRODUCT REDESIGN) - the
 * shared, reusable Compose building blocks every screen (Dashboard/Market/
 * Automations) now composes from, so typography/spacing/corner-radius/
 * status-color conventions live in exactly one place rather than being
 * re-decided per screen. Deliberately small: five components, no theming
 * framework, no new dependency - per the milestone's own "do not
 * over-engineer" constraint. Every value shown by a caller of these
 * components still comes from the real API response models in
 * `data/Models.kt` - these are presentation-only, they never compute or
 * invent a number themselves.
 */

/** A muted, uppercase, letter-spaced section label - used above every major group of content on a screen instead of an ad-hoc `titleMedium` per screen. */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier) {
    Text(
        text = title.uppercase(),
        style = MaterialTheme.typography.labelMedium.copy(letterSpacing = 1.2.sp),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier,
    )
}

/** A small colored dot + label - the one "status" visual language used everywhere a state needs to read at a glance (export recommendation, source health, automation on/off). */
@Composable
fun StatusBadge(text: String, color: Color, modifier: Modifier = Modifier) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = modifier) {
        Canvas(modifier = Modifier.size(8.dp)) { drawCircle(color = color) }
        Spacer(modifier = Modifier.width(6.dp))
        Text(text = text, style = MaterialTheme.typography.labelLarge, color = color, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * The dominant "glanceable intelligence" hero: one big number + unit, an
 * optional title above it (e.g. "PRODUCING"), and an optional status badge
 * below. Used for Dashboard's live status and Market's current price -
 * always the first thing on the screen, always built from real data the
 * caller already fetched (never a default/placeholder value baked in here).
 */
@Composable
fun HeroCard(
    title: String?,
    value: String,
    unit: String,
    statusText: String? = null,
    statusColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(20.dp),
    ) {
        if (title != null) {
            SectionHeader(title = title)
            Spacer(modifier = Modifier.height(8.dp))
        }
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                text = value,
                style = MaterialTheme.typography.displaySmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = unit,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (statusText != null) {
            Spacer(modifier = Modifier.height(10.dp))
            StatusBadge(text = statusText, color = statusColor)
        }
        if (subtitle != null) {
            Spacer(modifier = Modifier.height(6.dp))
            Text(text = subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** One cell of a [MetricGrid] - a compact KPI, not a text-list row: a small accent bar, a muted label, then a large value + small unit. */
data class Metric(
    val label: String,
    val value: String,
    val unit: String = "",
    val accent: Color? = null,
)

/**
 * A premium KPI presentation (2 columns, wraps to as many rows as needed) -
 * replaces the old plain vertical list of "Label: value unit" lines. Not
 * lazy/scrollable on its own: every screen already scrolls as a whole
 * Column, so this only ever chunks `metrics` into rows via plain
 * `Row`/`Column`, matching the rest of these screens' existing scroll
 * structure instead of introducing a second, nested scroll container.
 */
@Composable
fun MetricGrid(metrics: List<Metric>, modifier: Modifier = Modifier, columns: Int = 2) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        metrics.chunked(columns).forEach { row ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { metric -> MetricCell(metric = metric, modifier = Modifier.weight(1f)) }
                repeat(columns - row.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun MetricCell(metric: Metric, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(12.dp),
    ) {
        if (metric.accent != null) {
            Spacer(
                modifier = Modifier
                    .width(20.dp)
                    .height(3.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(metric.accent),
            )
            Spacer(modifier = Modifier.height(6.dp))
        }
        Text(text = metric.label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 4.dp)) {
            Text(
                text = metric.value,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (metric.unit.isNotEmpty()) {
                Spacer(modifier = Modifier.width(4.dp))
                Text(text = metric.unit, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/**
 * All 7 automation days in a fixed 4+3 grid - never a horizontally-scrolling
 * row. This is the direct fix for the redesign's hard requirement ("ALL
 * SEVEN DAYS MUST BE VISIBLE ON THE SCREEN AT THE SAME TIME. NO horizontal
 * scrolling.") - each cell gets `Modifier.weight(1f)` of a fixed 4-column
 * row (the second row pads its missing 4th cell with a blank spacer of the
 * same weight) so both rows always align to the same column grid regardless
 * of screen width.
 */
@Composable
fun DaySelectorGrid(
    days: List<Pair<String, String>>,
    selected: Set<String>,
    onToggle: (String) -> Unit,
    modifier: Modifier = Modifier,
    columns: Int = 4,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        days.chunked(columns).forEach { row ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { (shortLabel, fullValue) ->
                    DayChip(
                        label = shortLabel,
                        isSelected = selected.contains(fullValue),
                        onClick = { onToggle(fullValue) },
                        modifier = Modifier.weight(1f),
                    )
                }
                repeat(columns - row.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun DayChip(label: String, isSelected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val background = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh
    val foreground = if (isSelected) Color.White else MaterialTheme.colorScheme.onSurfaceVariant

    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(background)
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = foreground,
            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
            textAlign = TextAlign.Center,
        )
    }
}
