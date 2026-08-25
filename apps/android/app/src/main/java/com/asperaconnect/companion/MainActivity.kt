package com.asperaconnect.companion

import android.content.Intent
import android.media.projection.MediaProjectionManager
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
import androidx.compose.ui.Modifier.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    private var pendingPin: String = ""

    private val projectionLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == RESULT_OK && result.data != null) {
                val intent = Intent(this, MirrorService::class.java).apply {
                    putExtra(MirrorService.EXTRA_RESULT_CODE, result.resultCode)
                    putExtra(MirrorService.EXTRA_RESULT_DATA, result.data)
                    putExtra(MirrorService.EXTRA_PIN, pendingPin)
                }
                ContextCompat.startForegroundService(this, intent)
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    var pin by remember { mutableStateOf("") }
                    var status by remember { mutableStateOf("Idle — LAN only, no cloud.") }

                    Column(
                        modifier = Modifier.padding(24.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text("Aspera Connect", style = MaterialTheme.typography.headlineMedium)
                        Text(
                            "Easy mode for Linux. Grant screen capture, then connect from the desktop app on the same Wi‑Fi.",
                        )
                        OutlinedTextField(
                            value = pin,
                            onValueChange = { pin = it },
                            label = { Text("Optional PIN") },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Button(
                            onClick = {
                                pendingPin = pin
                                val mpm = getSystemService(MediaProjectionManager::class.java)
                                projectionLauncher.launch(mpm.createScreenCaptureIntent())
                                status = "Waiting for capture permission…"
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Start mirroring")
                        }
                        Button(
                            onClick = {
                                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Enable input accessibility")
                        }
                        Button(
                            onClick = {
                                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Enable notification access")
                        }
                        Button(
                            onClick = {
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
}
