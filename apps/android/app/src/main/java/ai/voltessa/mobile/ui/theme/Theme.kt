package ai.voltessa.mobile.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Visual-only theme, ported directly from the real Web palette (no
 * redesign, no new visual language) - see:
 *   - apps/web/app/globals.css: --background #050816, --foreground #f8fafc
 *   - components/ui/Button.tsx: primary = bg-blue-600 (#2563eb) / hover
 *     blue-500 (#3b82f6) - the "Log In" button's exact color
 *   - components/auth/AuthField.tsx: inputs = white/5% over background,
 *     border white/10%, focus border blue-500
 *   - components/dashboard/WeatherCard.tsx and friends: cards = white/3%
 *     over background, border white/10%
 *   - app/[locale]/login/LoginForm.tsx: links = blue-400 (#60a5fa) / hover
 *     blue-300 (#93c5fd), errors = red-400 (#f87171), muted text =
 *     slate-400 (#94a3b8) / slate-500 (#64748b)
 *
 * Web is always dark (no light-mode branch in globals.css), so this theme
 * is applied unconditionally regardless of the device's system theme -
 * matching Web's own single fixed identity rather than branching into a
 * second, undesigned light palette.
 *
 * Every Material3 role a `Surface`/`Card`/`Button`/`OutlinedButton`/
 * `TextButton` reads a default color from is set explicitly here
 * (including the surfaceContainer* tonal roles Material3 derives card
 * backgrounds from) - leaving any of these unset is exactly what let
 * Compose's own baseline (violet-tinted) palette show through before this
 * change, which is the purple/lavender being removed.
 */
private val VoltessaBackground = Color(0xFF050816)
private val VoltessaForeground = Color(0xFFF8FAFC)
private val VoltessaMutedText = Color(0xFF94A3B8) // slate-400
private val VoltessaBlue600 = Color(0xFF2563EB) // primary action - the "Log In" button
private val VoltessaBlue500 = Color(0xFF3B82F6) // hover/focus
private val VoltessaBlue400 = Color(0xFF60A5FA) // links
private val VoltessaBlue300 = Color(0xFF93C5FD) // link hover / on-primary-container text
private val VoltessaRed400 = Color(0xFFF87171) // errors

// Navy surfaces at increasing "elevation," each a flattened white-alpha-
// over-#050816 blend (matching Web's own bg-white/[x%] convention) rather
// than an unrelated invented hue.
private val SurfaceDimmest = Color(0xFF050816) // background itself
private val SurfaceLow = Color(0xFF0A0D1A) // white ~2%
private val Surface = Color(0xFF0D0F1D) // white ~3% - cards
private val SurfaceHigh = Color(0xFF121422) // white ~5% - inputs
private val SurfaceHighest = Color(0xFF171A2B) // white ~7%
private val OutlineNavy = Color(0xFF262B3D) // white ~12% - borders
private val OutlineVariantNavy = Color(0xFF1E212D) // white ~10% - subtler borders/dividers
private val SelectedContainer = Color(0xFF0A1636) // blue-600 at ~15% over background - selected-card highlight

private val VoltessaDarkColorScheme = darkColorScheme(
    primary = VoltessaBlue600,
    onPrimary = Color.White,
    primaryContainer = SelectedContainer,
    onPrimaryContainer = VoltessaBlue300,
    inversePrimary = VoltessaBlue300,

    secondary = VoltessaBlue400,
    onSecondary = Color.White,
    secondaryContainer = SelectedContainer,
    onSecondaryContainer = VoltessaBlue300,

    tertiary = VoltessaBlue400,
    onTertiary = Color.White,
    tertiaryContainer = SelectedContainer,
    onTertiaryContainer = VoltessaBlue300,

    background = VoltessaBackground,
    onBackground = VoltessaForeground,

    surface = Surface,
    onSurface = VoltessaForeground,
    surfaceVariant = SurfaceHigh,
    onSurfaceVariant = VoltessaMutedText,
    surfaceTint = VoltessaBlue600,

    surfaceBright = SurfaceHighest,
    surfaceDim = SurfaceDimmest,
    surfaceContainerLowest = SurfaceDimmest,
    surfaceContainerLow = SurfaceLow,
    surfaceContainer = Surface,
    surfaceContainerHigh = SurfaceHigh,
    surfaceContainerHighest = SurfaceHighest,

    inverseSurface = VoltessaForeground,
    inverseOnSurface = VoltessaBackground,

    error = VoltessaRed400,
    onError = Color.White,
    errorContainer = Color(0xFF3A1A1A),
    onErrorContainer = VoltessaRed400,

    outline = OutlineNavy,
    outlineVariant = OutlineVariantNavy,
    scrim = Color.Black,
)

/** Applies the Voltessa Web palette (dark navy + bright blue) - no light-theme branch, matching Web's own single fixed dark identity. */
@Composable
fun VoltessaTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = VoltessaDarkColorScheme, content = content)
}

/**
 * Mobile Redesign milestone - semantic status colors, additive only (no
 * existing `darkColorScheme` role above is touched, so nothing already
 * depending on those roles can regress). Taken directly from Web's own
 * Tailwind usage for the exact same semantics - not invented for this app:
 * `text-emerald-400`/`bg-emerald-400` for healthy/production/export-
 * recommended (EnergyFlowDiagram.tsx, KPICard.tsx, MarketOverviewCard.tsx),
 * `text-amber-400`/`bg-amber-400` for energy/attention (ForecastCard.tsx,
 * InvertersCard.tsx), `bg-orange-400` for grid-import/consumption
 * (EnergyFlowDiagram.tsx).
 */
val VoltessaGreen = Color(0xFF34D399) // emerald-400
val VoltessaAmber = Color(0xFFFBBF24) // amber-400
val VoltessaOrange = Color(0xFFFB923C) // orange-400
