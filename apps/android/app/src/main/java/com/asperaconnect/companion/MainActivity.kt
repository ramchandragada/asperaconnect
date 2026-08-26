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

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != CompanionService.ACTION_STATUS) return
            applyLinkStatus(
                intent.getStringExtra(CompanionService.EXTRA_STATUS)
                    ?: CompanionService.STATUS_STOPPED,
                intent.getStringExtra(CompanionService.EXTRA_PC_NAME),
                intent.getStringExtra(CompanionService.EXTRA_IP),
            )
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
                val intent = Intent(this, MirrorService::class.java).apply {
                    putExtra(MirrorService.EXTRA_RESULT_CODE, result.resultCode)
                    putExtra(MirrorService.EXTRA_RESULT_DATA, result.data)
                    putExtra(MirrorService.EXTRA_PIN, pendingPin)
                }
                ContextCompat.startForegroundService(this, intent)
                statusText.text = "Mirroring started (experimental)."
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
        findViewById<TextView>(R.id.portText).text = "Port ${CompanionService.PORT}"
        refreshIp()
        applyLinkStatus(CompanionService.lastStatus, CompanionService.linkedPcName, CompanionService.lastLocalIp)

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
            pendingPin = pinInput.text?.toString().orEmpty()
            CompanionService.start(this, pendingPin)
            val mpm = getSystemService(MediaProjectionManager::class.java)
            projectionLauncher.launch(mpm.createScreenCaptureIntent())
            statusText.text = "Waiting for capture permission…"
        }

        findViewById<Button>(R.id.accessibilityButton).setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        findViewById<Button>(R.id.stopButton).setOnClickListener {
            CompanionService.stop(this)
            stopService(Intent(this, MirrorService::class.java))
            applyLinkStatus(CompanionService.STATUS_STOPPED, null, CompanionService.guessLocalIpv4())
            statusText.text = getString(R.string.footer)
        }
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter(CompanionService.ACTION_STATUS)
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
                    "On the PC: Aspera Connect → Easy mode → Connect. Use this IP (${ip ?: "…"}). Phone Wi‑Fi + PC wired LAN is fine if they can reach each other."
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
