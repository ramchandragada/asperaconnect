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
        versionCode = 19
        versionName = "0.3.10"
    }

    signingConfigs {
        create("sideload") {
            // Checked-in sideload key — public demo builds only (not Play Store).
            storeFile = rootProject.file("aspera-sideload.keystore")
            storePassword = "aspera-connect"
            keyAlias = "aspera"
            keyPassword = "aspera-connect"
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isDebuggable = false
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
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}

