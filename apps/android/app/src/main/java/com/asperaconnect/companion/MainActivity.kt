package com.asperaconnect.companion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    private var pendingPin: String = ""
    private lateinit var statusText: TextView
    private lateinit var ipText: TextView
    private lateinit var pinInput: EditText

    private val callPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            statusText.text =
                if (granted) {
                    "Phone permission granted — PC can place calls directly."
                } else {
                    "Phone permission denied — PC calls will open the dialer (tap Call)."
                }
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
                statusText.text =
                    "Mirroring started (experimental). Control plane on port ${CompanionService.PORT}."
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.statusText)
        ipText = findViewById(R.id.ipText)
        pinInput = findViewById(R.id.pinInput)
        findViewById<TextView>(R.id.portText).text = "Port: ${CompanionService.PORT}"
        refreshIp()

        findViewById<Button>(R.id.listenButton).setOnClickListener {
            pendingPin = pinInput.text?.toString().orEmpty()
            ensureCallPermission()
            CompanionService.start(this, pendingPin)
            refreshIp()
            val ip = CompanionService.guessLocalIpv4() ?: "unknown"
            statusText.text = "Listening on $ip:${CompanionService.PORT}"
        }

        findViewById<Button>(R.id.phonePermButton).setOnClickListener {
            ensureCallPermission()
        }

        findViewById<Button>(R.id.mirrorButton).setOnClickListener {
            pendingPin = pinInput.text?.toString().orEmpty()
            CompanionService.start(this, pendingPin)
            val mpm = getSystemService(MediaProjectionManager::class.java)
            projectionLauncher.launch(mpm.createScreenCaptureIntent())
            statusText.text = "Waiting for capture permission..."
        }

        findViewById<Button>(R.id.accessibilityButton).setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        findViewById<Button>(R.id.stopButton).setOnClickListener {
            CompanionService.stop(this)
            stopService(Intent(this, MirrorService::class.java))
            statusText.text = "Stopped"
        }
    }

    override fun onResume() {
        super.onResume()
        refreshIp()
    }

    private fun refreshIp() {
        val ip = CompanionService.lastLocalIp
            ?: CompanionService.guessLocalIpv4()
            ?: "connect to Wi-Fi"
        ipText.text = "This phone IP: $ip"
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
