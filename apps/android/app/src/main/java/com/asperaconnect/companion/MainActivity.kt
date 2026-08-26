package com.asperaconnect.companion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier.modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    private var pendingPin: String = ""
    private var statusSetter: ((String) -> Unit)? = null

    private val callPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            statusSetter?.invoke(
                if (granted) {
                    "Phone permission granted — PC can place calls directly."
                } else {
                    "Phone permission denied — PC calls will open the dialer (tap Call)."
                },
            )
        }

    private val projectionLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == RESULT_OK && result.data != null) {
                CompanionService.start(this, pendingPin)
                val intent = Intent(this, MirrorService::class.java).apply {
                    putExtra(MirrorService.EXTRA_RESULT_CODE, result.resultCode)
                    putExtra(MirrorService.EXTRA_RESULT_DATA, result.data)
                    putExtra(MirrorService.EXTRA_PIN, pendingPin)
                }
                ContextCompat.startForegroundService(this, intent)
                statusSetter?.invoke(
                    "Mirroring started (experimental). Control plane on port ${CompanionService.PORT}.",
                )
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    var pin by remember { mutableStateOf("") }
                    var status by remember {
                        mutableStateOf("Idle — LAN only, no cloud. No Developer Options needed.")
                    }
                    statusSetter = { status = it }
                    val ip = CompanionService.lastLocalIp
                        ?: CompanionService.guessLocalIpv4()
                        ?: "connect to Wi-Fi"

                    Column(
                        modifier = Modifier.padding(24.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text("Aspera Connect", style = MaterialTheme.typography.headlineMedium)
                        Text(
                            "Easy mode for Linux. Same Wi-Fi as your PC. " +
                                "Hub / Zoho click-to-call works after you tap Listen.",
                        )
                        Text("This phone IP: $ip", style = MaterialTheme.typography.titleMedium)
                        Text("Port: ${CompanionService.PORT}")
                        OutlinedTextField(
                            value = pin,
                            onValueChange = { pin = it },
                            label = { Text("Optional PIN (match desktop)") },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Button(
                            onClick = {
                                pendingPin = pin
                                ensureCallPermission()
                                CompanionService.start(this@MainActivity, pin)
                                status =
                                    "Listening on ${CompanionService.guessLocalIpv4() ?: ip}:${CompanionService.PORT}"
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("1. Listen for PC (click-to-call)")
                        }
                        Button(
                            onClick = { ensureCallPermission() },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("2. Allow phone calls (recommended)")
                        }
                        Button(
                            onClick = {
                                pendingPin = pin
                                CompanionService.start(this@MainActivity, pin)
                                val mpm = getSystemService(MediaProjectionManager::class.java)
                                projectionLauncher.launch(mpm.createScreenCaptureIntent())
                                status = "Waiting for capture permission..."
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Optional: Start screen mirror")
                        }
                        Button(
                            onClick = {
                                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Optional: Enable tap accessibility")
                        }
                        Button(
                            onClick = {
                                CompanionService.stop(this@MainActivity)
                                stopService(Intent(this@MainActivity, MirrorService::class.java))
                                status = "Stopped"
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Stop")
                        }
                        Text(status)
                    }
                }
            }
        }
    }

    private fun ensureCallPermission() {
        if (Build.VERSION.SDK_INT < 23) return
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) {
            callPermissionLauncher.launch(Manifest.permission.CALL_PHONE)
        }
    }
}
