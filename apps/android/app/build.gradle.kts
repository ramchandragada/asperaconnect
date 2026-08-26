plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.asperaconnect.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.asperaconnect.companion"
        minSdk = 26
        targetSdk = 35
        versionCode = 13
        versionName = "0.3.4"
    }

    signingConfigs {
        // Sideload / CI: sign release with the Android debug keystore so
        // `adb install` works without a private release key.
        create("sideload") {
            val home = System.getProperty("user.home")
            storeFile = file("$home/.android/debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("sideload")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
