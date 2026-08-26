package com.asperaconnect.companion

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

/**
 * Super-simple companion UI:
 * Option 1 — Phone calls
 * Option 2 — Phone calls + Mirror
 */
class MainActivity : ComponentActivity() {
    private var pendingPin: String = ""
    private var wantMirrorAfterCalls = false

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
                MirrorService.ACTION_REQUEST_CAPTURE -> launchScreenCapture()
            }
        }
    }

    private val callPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            if (wantMirrorAfterCalls) {
                wantMirrorAfterCalls = false
                launchScreenCapture()
            } else {
                statusText.text = "Ready — you can leave this app. Keep the notification."
                maybeAskBatteryOpt()
            }
        }

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    private val projectionLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == RESULT_OK && result.data != null) {
                CompanionService.start(this, pendingPin)
                MirrorService.startWithProjection(this, result.resultCode, result.data!!, pendingPin)
                statusText.text = "Almost done — on the PC tap Start mirror."
            } else {
                refreshCaptureUi(false)
                statusText.text = "Mirror cancelled. You can still use Option 1 for calls."
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
        ensureNotificationPermission()

        // Option 1 — Phone calls
        findViewById<Button>(R.id.listenButton).setOnClickListener {
            startCallsOnly()
        }

        // Option 2 — Phone calls + Mirror
        findViewById<Button>(R.id.mirrorButton).setOnClickListener {
            startCallsAndMirror()
        }

        findViewById<Button>(R.id.stopButton).setOnClickListener {
            CompanionService.stop(this)
            MirrorService.stop(this)
            applyLinkStatus(CompanionService.STATUS_STOPPED, null, CompanionService.guessLocalIpv4())
            refreshCaptureUi(false)
            statusText.text = getString(R.string.footer)
        }

        // Keep hidden buttons from crashing if referenced elsewhere
        findViewById<Button>(R.id.phonePermButton).setOnClickListener { ensureCallPermission(false) }
        findViewById<Button>(R.id.accessibilityButton).setOnClickListener { }

        maybeHandleCaptureIntent(intent)
    }

    private fun startCallsOnly() {
        wantMirrorAfterCalls = false
        pendingPin = pinInput.text?.toString().orEmpty()
        CompanionService.start(this, pendingPin)
        refreshIp()
        val ip = CompanionService.guessLocalIpv4() ?: "…"
        applyLinkStatus(CompanionService.STATUS_LISTENING, null, ip)
        statusText.text = "Ready — you can leave this app. PC uses IP $ip"
        ensureCallPermission(thenMirror = false)
        maybeAskBatteryOpt()
    }

    private fun startCallsAndMirror() {
        pendingPin = pinInput.text?.toString().orEmpty()
        CompanionService.start(this, pendingPin)
        refreshIp()
        val ip = CompanionService.guessLocalIpv4() ?: "…"
        applyLinkStatus(CompanionService.STATUS_LISTENING, null, ip)
        statusText.text = "Next: allow screen share when Android asks."
        ensureCallPermission(thenMirror = true)
        maybeAskBatteryOpt()
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
            captureText.visibility = TextView.VISIBLE
            captureText.setTextColor(ContextCompat.getColor(this, R.color.accent))
            captureText.text = getString(R.string.capture_on)
        } else if (CompanionService.isRunning()) {
            captureText.visibility = TextView.VISIBLE
            captureText.setTextColor(ContextCompat.getColor(this, R.color.muted))
            captureText.text = getString(R.string.capture_off)
        } else {
            captureText.visibility = TextView.GONE
        }
    }

    private fun applyLinkStatus(status: String, pcName: String?, ip: String?) {
        when (status) {
            CompanionService.STATUS_LINKED -> {
                linkBanner.setBackgroundResource(R.drawable.bg_status_ok)
                linkPill.setBackgroundResource(R.drawable.bg_pill_ok)
                linkPill.setTextColor(ContextCompat.getColor(this, R.color.accent_ink))
                linkPill.text = "Connected"
                linkTitle.setTextColor(ContextCompat.getColor(this, R.color.accent))
                linkTitle.text = getString(R.string.status_linked_title)
                linkDetail.setTextColor(ContextCompat.getColor(this, R.color.ink_dim))
                linkDetail.text = "PC can place calls${pcName?.let { " ($it)" } ?: ""}. You can leave this app."
                statusText.text = "Connected — leave the app open in the background (notification stays)."
            }
            CompanionService.STATUS_LISTENING -> {
                linkBanner.setBackgroundResource(R.drawable.bg_status_warn)
                linkPill.setBackgroundResource(R.drawable.bg_pill_warn)
                linkPill.setTextColor(ContextCompat.getColor(this, R.color.amber_ink))
                linkPill.text = "Waiting"
                linkTitle.setTextColor(ContextCompat.getColor(this, R.color.amber))
                linkTitle.text = getString(R.string.status_listening_title)
                linkDetail.setTextColor(ContextCompat.getColor(this, R.color.ink_dim))
                linkDetail.text = "On the PC enter IP ${ip ?: "…"}. You can leave this app — keep the notification."
                statusText.text = "Waiting for PC — notification means it is still running."
            }
            CompanionService.STATUS_FAILED -> {
                linkBanner.setBackgroundResource(R.drawable.bg_status_bad)
                linkPill.setBackgroundResource(R.drawable.bg_pill_bad)
                linkPill.setTextColor(ContextCompat.getColor(this, android.R.color.white))
                linkPill.text = "Failed"
                linkTitle.setTextColor(ContextCompat.getColor(this, R.color.danger))
                linkTitle.text = getString(R.string.status_failed_title)
                linkDetail.setTextColor(ContextCompat.getColor(this, R.color.ink_dim))
                linkDetail.text = "Try Option 1 or 2 again."
                statusText.text = "Something went wrong — try again."
            }
            else -> {
                linkBanner.setBackgroundResource(R.drawable.bg_status_warn)
                linkPill.setBackgroundResource(R.drawable.bg_pill_warn)
                linkPill.setTextColor(ContextCompat.getColor(this, R.color.amber_ink))
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
            ?: "Connect to office Wi‑Fi"
        ipText.text = ip
    }

    private fun ensureCallPermission(thenMirror: Boolean) {
        wantMirrorAfterCalls = thenMirror
        if (Build.VERSION.SDK_INT < 23) {
            if (thenMirror) launchScreenCapture()
            return
        }
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) {
            callPermissionLauncher.launch(Manifest.permission.CALL_PHONE)
        } else if (thenMirror) {
            wantMirrorAfterCalls = false
            launchScreenCapture()
        }
    }

    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    /** OnePlus / aggressive OEMs kill background apps unless battery opt is off. */
    private fun maybeAskBatteryOpt() {
        if (Build.VERSION.SDK_INT < 23) return
        try {
            val pm = getSystemService(PowerManager::class.java)
            if (pm.isIgnoringBatteryOptimizations(packageName)) return
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                },
            )
        } catch (_: Exception) {
            try {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            } catch (_: Exception) {
            }
        }
    }
}
