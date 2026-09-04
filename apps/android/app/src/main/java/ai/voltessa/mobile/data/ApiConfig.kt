package ai.voltessa.mobile.data

/**
 * Single source of truth for the API base URL (M2 requirement #4). Only
 * production is wired up for this milestone - deliberately a single
 * `const val`, not a UI-facing environment switcher, but factored into its
 * own object so a future BuildConfig-driven dev/staging value can replace
 * this one call site without touching every repository/screen.
 */
object ApiConfig {
    const val BASE_URL: String = "https://app.voltessa.ai"
}
