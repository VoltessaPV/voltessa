plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "ai.voltessa.mobile"
    // M5: bumped from 34 to 35 - androidx.credentials (Credential Manager)
    // 1.6.0 requires compiling against API 35 (and AGP 8.6+, bumped above).
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.voltessa.mobile"
        // Samsung Galaxy S21 ships with Android 11 (API 30) and receives
        // updates well beyond it - minSdk 26 is a normal modern-Android
        // baseline, not tuned to one specific device.
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-m2"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.activity:activity-compose:1.9.2")

    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")

    // Networking - plain OkHttp, no Retrofit: four simple JSON endpoints
    // don't need a request-declaration framework on top.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // Secure on-device token storage (Android Keystore-backed) - see
    // TokenStore.kt. Not plain SharedPreferences.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Google Sign-In (M5) - the official Android Credential Manager / Sign
    // in with Google APIs, per the milestone's explicit requirement (never
    // a manually-implemented WebView OAuth flow).
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
}
