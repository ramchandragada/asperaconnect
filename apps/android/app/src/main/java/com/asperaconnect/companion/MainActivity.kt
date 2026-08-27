package com.asperaconnect.companion

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.google.zxing.client.android.Intents
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONObject
import kotlin.concurrent.thread

/** Call-only companion: listen for PC click-to-call. */
class MainActivity : ComponentActivity() {
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

    private val permissionsLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            statusText.text = "Ready — you can leave this app. Keep the notification."
            maybeAskBatteryOpt()
        }

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    private val cameraPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) openQrScanner()
            else Toast.makeText(this, "Camera needed to scan PC QR", Toast.LENGTH_LONG).show()
        }

    private val qrLauncher = registerForActivityResult(ScanContract()) { result ->
        val raw = result.contents ?: return@registerForActivityResult
        handleQrPayload(raw)
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
        findViewById<TextView>(R.id.versionText).text = try {
            val p = packageManager.getPackageInfo(packageName, 0)
            "v${p.versionName}"
        } catch (_: Exception) {
            "v0.3.9"
        }

        refreshIp()
        applyLinkStatus(CompanionService.lastStatus, CompanionService.linkedPcName, CompanionService.lastLocalIp)
        ensureNotificationPermission()

        findViewById<Button>(R.id.listenButton).setOnClickListener {
            startListening()
        }

        findViewById<Button>(R.id.scanQrButton).setOnClickListener {
            ensureCameraThenScan()
        }

        findViewById<Button>(R.id.stopButton).setOnClickListener {
            CompanionService.stop(this)
            applyLinkStatus(CompanionService.STATUS_STOPPED, null, CompanionService.guessLocalIpv4(this))
            statusText.text = getString(R.string.footer)
        }
    }

    private fun ensureCameraThenScan() {
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) openQrScanner()
        else cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
    }

    private fun openQrScanner() {
        val options = ScanOptions().apply {
            setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            setPrompt("Scan the QR on Aspera Connect (PC)")
            setBeepEnabled(false)
            setOrientationLocked(true)
            addExtra(Intents.Scan.SCAN_TYPE, Intents.Scan.MIXED_SCAN)
        }
        qrLauncher.launch(options)
    }

    private fun handleQrPayload(raw: String) {
        when (val parsed = QrPairing.parseAny(raw)) {
            is QrPairing.Parsed.Cloud -> {
                statusText.text = "Connecting over internet to ${parsed.offer.pcName}…"
                startListening()
                thread {
                    RelaySession.joinFromQr(
                        parsed.offer,
                        onPaired = { ok, message ->
                            runOnUiThread {
                                statusText.text = message
                                Toast.makeText(this@MainActivity, message, Toast.LENGTH_LONG).show()
                                if (ok) {
                                    applyLinkStatus(
                                        CompanionService.STATUS_LINKED,
                                        parsed.offer.pcName,
                                        CompanionService.guessLocalIpv4(this@MainActivity),
                                    )
                                }
                            }
                        },
                        onCommand = { msg, reply ->
                            val svc = CompanionService.instance
                            val ack = svc?.handleRelayCommand(msg)
                                ?: JSONObject().put("type", "error").put("reason", "service_stopped")
                            reply(ack)
                        },
                    )
                }
            }
            is QrPairing.Parsed.Lan -> {
                startListening()
                statusText.text = "Pairing with ${parsed.offer.pcName}…"
                thread {
                    val phoneIp = CompanionService.guessLocalIpv4(this@MainActivity)
                    if (phoneIp.isNullOrBlank()) {
                        runOnUiThread {
                            statusText.text = "No Wi‑Fi IP — connect phone to the same network as the PC"
                            Toast.makeText(
                                this@MainActivity,
                                "Join the PC’s Wi‑Fi / office LAN first",
                                Toast.LENGTH_LONG,
                            ).show()
                        }
                        return@thread
                    }
                    val result = QrPairing.pairWithPc(parsed.offer, phoneIp)
                    runOnUiThread {
                        statusText.text = result.message
                        Toast.makeText(this@MainActivity, result.message, Toast.LENGTH_LONG).show()
                    }
                }
            }
            null -> Toast.makeText(this, "Not an Aspera PC QR", Toast.LENGTH_LONG).show()
        }
    }

    private fun startListening() {
        val pin = pinInput.text?.toString().orEmpty()
        CompanionService.start(this, pin)
        refreshIp()
        val ip = CompanionService.guessLocalIpv4(this) ?: "…"
        applyLinkStatus(CompanionService.STATUS_LISTENING, null, ip)
        statusText.text = "Ready — you can leave this app. PC uses IP $ip"
        ensureCallAndContactsPermissions()
        maybeAskBatteryOpt()
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
                linkPill.text = "Connected"
                linkTitle.setTextColor(ContextCompat.getColor(this, R.color.accent))
                linkTitle.text = getString(R.string.status_linked_title)
                linkDetail.setTextColor(ContextCompat.getColor(this, R.color.ink_dim))
                linkDetail.text = "PC can place calls${pcName?.let { " ($it)" } ?: ""}. You can leave this app."
                statusText.text = "Connected — leave the app in the background (notification stays)."
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
                linkPill.setTextColor(ContextCompat.getColor(this, R.color.danger_ink))
                linkPill.text = "Failed"
                linkTitle.setTextColor(ContextCompat.getColor(this, R.color.danger))
                linkTitle.text = getString(R.string.status_failed_title)
                linkDetail.setTextColor(ContextCompat.getColor(this, R.color.ink_dim))
                linkDetail.text = "Tap Start for calls and try again."
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
            ?: CompanionService.guessLocalIpv4(this)
            ?: "Connect to office Wi‑Fi"
        ipText.text = ip
    }

    private fun ensureCallAndContactsPermissions() {
        if (Build.VERSION.SDK_INT < 23) return
        val needed = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.CALL_PHONE)
        }
        if (Build.VERSION.SDK_INT >= 26 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ANSWER_PHONE_CALLS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.ANSWER_PHONE_CALLS)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.READ_CONTACTS)
        }
        if (needed.isNotEmpty()) {
            permissionsLauncher.launch(needed.toTypedArray())
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
