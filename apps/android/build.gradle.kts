// Voltessa Android client (M2). Standalone Gradle project - not part of the
// pnpm workspace, mirroring how `automation/` is a self-contained sibling of
// `apps/web` rather than a workspace member. Plugin versions declared once
// here, applied per-module below.
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
