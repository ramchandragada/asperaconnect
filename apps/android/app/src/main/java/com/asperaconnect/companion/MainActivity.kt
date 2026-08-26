package com.asperaconnect.companion

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    private var pendingPin: String = ""
    private lateinit var statusText: TextView
    private lateinit var ipText: TextView
    private lateinit var pinInput: EditText
    private lateinit var linkBanner: LinearLayout
    private lateinit var linkTitle: TextView
    private lateinit var linkDetail: TextView
    private lateinit var linkPill: TextView
    private lateinit var captureText: TextView

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                CompanionService.ACTION_STATUS -> {
                    applyLinkStatus(
                        intent.getStringExtra(CompanionService.EXTRA_STATUS)
                            ?: CompanionService.STATUS_STOPPED,
                        intent.getStringExtra(CompanionService.EXTRA_PC_NAME),
                        intent.getStringExtra(CompanionService.EXTRA_IP),
                    )
                }
                MirrorService.ACTION_CAPTURE_STATE -> {
                    refreshCaptureUi(intent.getBooleanExtra(MirrorService.EXTRA_CAPTURE_READY, false))
                }
                MirrorService.ACTION_REQUEST_CAPTURE -> {
                    launchScreenCapture()
                }
            }
        }
    }

    private val callPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            statusText.text =
                if (granted) {
                    "Phone permission granted — PC can place calls directly."
                } else {
                    "Phone permission denied — PC calls will open the dialer."
                }
        }

    private val projectionLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == RESULT_OK && result.data != null) {
                CompanionService.start(this, pendingPin)
                MirrorService.startWithProjection(this, result.resultCode, result.data!!, pendingPin)
                statusText.text = "Starting screen capture…"
            } else {
                refreshCaptureUi(false)
                statusText.text = "Screen capture cancelled — tap step 3 again."
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.statusText)
        ipText = findViewById(R.id.ipText)
        pinInput = findViewById(R.id.pinInput)
        linkBanner = findViewById(R.id.linkBanner)
        linkTitle = findViewById(R.id.linkTitle)
        linkDetail = findViewById(R.id.linkDetail)
        linkPill = findViewById(R.id.linkPill)
        captureText = findViewById(R.id.captureText)
        findViewById<TextView>(R.id.portText).text = "Port ${CompanionService.PORT}"
        refreshIp()
        applyLinkStatus(CompanionService.lastStatus, CompanionService.linkedPcName, CompanionService.lastLocalIp)
        refreshCaptureUi(MirrorBridge.hasProjection() || MirrorBridge.isStreaming())

        findViewById<Button>(R.id.listenButton).setOnClickListener {
            pendingPin = pinInput.text?.toString().orEmpty()
            ensureCallPermission()
            CompanionService.start(this, pendingPin)
            refreshIp()
            val ip = CompanionService.guessLocalIpv4() ?: "unknown"
            applyLinkStatus(CompanionService.STATUS_LISTENING, null, ip)
        }

        findViewById<Button>(R.id.phonePermButton).setOnClickListener {
            ensureCallPermission()
        }

        findViewById<Button>(R.id.mirrorButton).setOnClickListener {
            launchScreenCapture()
        }

        findViewById<Button>(R.id.accessibilityButton).setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        findViewById<Button>(R.id.stopButton).setOnClickListener {
            CompanionService.stop(this)
            MirrorService.stop(this)
            applyLinkStatus(CompanionService.STATUS_STOPPED, null, CompanionService.guessLocalIpv4())
            refreshCaptureUi(false)
            statusText.text = getString(R.string.footer)
        }

        maybeHandleCaptureIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        maybeHandleCaptureIntent(intent)
    }

    private fun maybeHandleCaptureIntent(intent: Intent?) {
        if (intent?.action == MirrorService.ACTION_REQUEST_CAPTURE) {
            launchScreenCapture()
        }
    }

    private fun launchScreenCapture() {
        pendingPin = pinInput.text?.toString().orEmpty()
        CompanionService.start(this, pendingPin)
        val mpm = getSystemService(MediaProjectionManager::class.java)
        projectionLauncher.launch(mpm.createScreenCaptureIntent())
        statusText.text = "Android will ask to start casting / recording — tap Start / Allow."
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter().apply {
            addAction(CompanionService.ACTION_STATUS)
            addAction(MirrorService.ACTION_CAPTURE_STATE)
            addAction(MirrorService.ACTION_REQUEST_CAPTURE)
        }
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(statusReceiver, filter)
        }
    }

    override fun onStop() {
        try {
            unregisterReceiver(statusReceiver)
        } catch (_: Exception) {
        }
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        refreshIp()
        applyLinkStatus(CompanionService.lastStatus, CompanionService.linkedPcName, CompanionService.lastLocalIp)
        refreshCaptureUi(MirrorBridge.hasProjection() || MirrorBridge.isStreaming())
    }

    private fun refreshCaptureUi(ready: Boolean) {
        if (ready) {
            captureText.setTextColor(ContextCompat.getColor(this, R.color.accent))
            captureText.text = "Screen capture: ON — now tap Start Easy mirror on the PC"
        } else {
            captureText.setTextColor(ContextCompat.getColor(this, R.color.amber))
            captureText.text = "Screen capture: OFF — tap “3. Allow screen capture” below"
        }
    }

    private fun applyLinkStatus(status: String, pcName: String?, ip: String?) {
        when (status) {
            CompanionService.STATUS_LINKED -> {
                linkBanner.setBackgroundResource(R.drawable.bg_status_ok)
                linkPill.setBackgroundResource(R.drawable.bg_pill_ok)
                linkPill.setTextColor(ContextCompat.getColor(this, R.color.accent_ink))
                linkPill.text = "Linked"
                linkTitle.setTextColor(ContextCompat.getColor(this, R.color.accent))
                linkTitle.text = getString(R.string.status_linked_title)
                linkDetail.setTextColor(ContextCompat.getColor(this, R.color.ink_dim))
                linkDetail.text = "Linked with ${pcName ?: "PC"}. Hub click‑to‑call is ready."
                statusText.text = "Connected${pcName?.let { " · $it" } ?: ""}"
            }
            CompanionService.STATUS_LISTENING -> {
                linkBanner.setBackgroundResource(R.drawable.bg_status_warn)
                linkPill.setBackgroundResource(R.drawable.bg_pill_warn)
                linkPill.setTextColor(ContextCompat.getColor(this, R.color.amber_ink))
                linkPill.text = "Listening"
                linkTitle.setTextColor(ContextCompat.getColor(this, R.color.amber))
                linkTitle.text = getString(R.string.status_listening_title)
                linkDetail.setTextColor(ContextCompat.getColor(this, R.color.ink_dim))
                linkDetail.text =
                    "On the PC: Aspera Connect → Easy mode → Connect. Use this IP (${ip ?: "…"})."
                statusText.text = "Listening on ${ip ?: "…"}:${CompanionService.PORT}"
            }
            CompanionService.STATUS_FAILED -> {
                linkBanner.setBackgroundResource(R.drawable.bg_status_bad)
                linkPill.setBackgroundResource(R.drawable.bg_pill_bad)
                linkPill.setTextColor(ContextCompat.getColor(this, android.R.color.white))
                linkPill.text = "Failed"
                linkTitle.setTextColor(ContextCompat.getColor(this, R.color.danger))
                linkTitle.text = getString(R.string.status_failed_title)
                linkDetail.setTextColor(ContextCompat.getColor(this, R.color.ink_dim))
                linkDetail.text = "PIN mismatch or rejected. Match PIN on phone and PC, then try again."
                statusText.text = "Connection failed — check PIN"
            }
            else -> {
                linkBanner.setBackgroundResource(R.drawable.bg_status_bad)
                linkPill.setBackgroundResource(R.drawable.bg_pill_bad)
                linkPill.setTextColor(ContextCompat.getColor(this, android.R.color.white))
                linkPill.text = "Off"
                linkTitle.setTextColor(ContextCompat.getColor(this, R.color.ink))
                linkTitle.text = getString(R.string.status_idle_title)
                linkDetail.setTextColor(ContextCompat.getColor(this, R.color.ink_dim))
                linkDetail.text = getString(R.string.status_idle_detail)
                statusText.text = getString(R.string.footer)
            }
        }
    }

    private fun refreshIp() {
        val ip = CompanionService.lastLocalIp
            ?: CompanionService.guessLocalIpv4()
            ?: "Join office Wi‑Fi / LAN"
        ipText.text = ip
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
