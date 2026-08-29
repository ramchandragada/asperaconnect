import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val playPropsFile = rootProject.file("play-upload.properties")
val playProps: Properties? =
    if (playPropsFile.exists()) {
        Properties().apply { playPropsFile.inputStream().use { load(it) } }
    } else {
        null
    }

android {
    namespace = "com.asperaconnect.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.asperaconnect.companion"
        minSdk = 26
        targetSdk = 35
        versionCode = 20
        versionName = "0.3.11"
    }

    signingConfigs {
        create("sideload") {
            storeFile = rootProject.file("aspera-sideload.keystore")
            storePassword = "aspera-connect"
            keyAlias = "aspera"
            keyPassword = "aspera-connect"
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
        if (playProps != null) {
            create("play") {
                storeFile = rootProject.file(playProps.getProperty("storeFile", "play-upload.keystore"))
                storePassword = playProps.getProperty("storePassword")
                keyAlias = playProps.getProperty("keyAlias", "aspera-upload")
                keyPassword = playProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isDebuggable = false
            signingConfig = signingConfigs.getByName("sideload")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
        create("play") {
            initWith(getByName("release"))
            matchingFallbacks += listOf("release")
            isDebuggable = false
            if (playProps != null) {
                signingConfig = signingConfigs.getByName("play")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
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
