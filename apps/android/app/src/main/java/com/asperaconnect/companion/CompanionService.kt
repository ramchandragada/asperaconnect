package com.asperaconnect.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * LAN control plane (TCP 17891) — pairing hello + click-to-call.
 * Runs as a foreground service so calls work when the app UI is closed.
 */
class CompanionService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var serverJob: Job? = null
    private val running = AtomicBoolean(false)
    private var nsdManager: NsdManager? = null
    private var registrationListener: NsdManager.RegistrationListener? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val pinRef = AtomicReference<String?>(null)
    private val linkedClients = AtomicInteger(0)
    private var foregroundReady = false
    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /** Handle companion JSON from cloud relay. */
    fun handleRelayCommand(msg: JSONObject): JSONObject {
        return when (msg.optString("type")) {
            "hello" -> {
                val pc = msg.optString("name", "PC")
                linkedClients.set(1)
                ensureForeground("Linked to $pc — click-to-call ready (internet)")
                broadcastStatus(STATUS_LINKED, pc)
                JSONObject()
                    .put("type", "helloAck")
                    .put("ok", true)
                    .put("protocol", PROTOCOL)
                    .put(
                        "capabilities",
                        JSONObject()
                            .put("placeCall", true)
                            .put("endCall", true)
                            .put("contacts", true)
                            .put("mirror", false)
                            .put("input", false),
                    )
            }
            "placeCall" -> {
                val number = msg.optString("number", "")
                val direct = msg.optBoolean("direct", true)
                val result = placeCall(number, direct)
                JSONObject()
                    .put("type", "placeCallAck")
                    .put("ok", result.first)
                    .put("message", result.second)
            }
            "endCall" -> {
                val result = endCall()
                JSONObject()
                    .put("type", "endCallAck")
                    .put("ok", result.first)
                    .put("message", result.second)
            }
            "listContacts" -> {
                val (ok, contacts) = ContactReader.listContacts(this)
                JSONObject()
                    .put("type", "contacts")
                    .put("ok", ok)
                    .put("contacts", contacts)
                    .put("reason", if (ok) JSONObject.NULL else "need_contacts_permission")
            }
            "ping" -> JSONObject().put("type", "pong")
            else -> JSONObject().put("type", "error").put("reason", "unknown")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                releaseLocks()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                pinRef.set(intent?.getStringExtra(EXTRA_PIN))
                getSharedPreferences(PREFS, MODE_PRIVATE)
                    .edit()
                    .putBoolean(PREF_WANT_LISTEN, true)
                    .apply()
                acquireLocks()
                registerNetworkCallback()
                refreshLocalIp("service start")
                ensureForeground(
                    "Ready for PC calls — you can leave this app. ${lastLocalIp ?: ""}",
                )
                registerNsd()
                if (running.compareAndSet(false, true)) {
                    serverJob = scope.launch { serve() }
                }
                if (linkedClients.get() == 0) {
                    linkedPcName = null
                    broadcastStatus(STATUS_LISTENING, null)
                }
            }
        }
        return START_STICKY
    }

    private fun acquireLocks() {
        try {
            val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            if (wifiLock == null) {
                @Suppress("DEPRECATION")
                wifiLock = wifi.createWifiLock(
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                    "aspera-companion-wifi",
                ).apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
            if (multicastLock == null) {
                multicastLock = wifi.createMulticastLock("aspera-companion-mcast").apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "wifi lock: ${e.message}")
        }
        try {
            if (wakeLock == null) {
                val pm = getSystemService(PowerManager::class.java)
                wakeLock = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "aspera:companion",
                ).apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "wake lock: ${e.message}")
        }
    }

    private fun registerNetworkCallback() {
        if (networkCallback != null) return
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        connectivityManager = cm
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
            .build()
        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                onNetworkChanged("available")
            }

            override fun onLost(network: Network) {
                onNetworkChanged("lost")
            }

            override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) {
                onNetworkChanged("link changed")
            }
        }
        cm.registerNetworkCallback(request, networkCallback!!)
    }

    private fun unregisterNetworkCallback() {
        try {
            networkCallback?.let { connectivityManager?.unregisterNetworkCallback(it) }
        } catch (_: Exception) {
        }
        networkCallback = null
        connectivityManager = null
    }

    private fun onNetworkChanged(reason: String) {
        if (!running.get()) return
        val prev = lastLocalIp
        refreshLocalIp(reason)
        if (lastLocalIp == null || lastLocalIp == prev) return
        Log.i(TAG, "Wi‑Fi IP changed: $prev -> $lastLocalIp ($reason)")
        val text = when (lastStatus) {
            STATUS_LINKED -> "Linked to ${linkedPcName ?: "PC"} — click-to-call ready"
            else -> "Listening for PC — ${lastLocalIp ?: "Wi‑Fi"}:$PORT"
        }
        ensureForeground(text)
        broadcastStatus(lastStatus, linkedPcName)
        reregisterNsd()
    }

    private fun refreshLocalIp(@Suppress("UNUSED_PARAMETER") reason: String) {
        lastLocalIp = guessLocalIpv4(this)
    }

    private fun reregisterNsd() {
        try {
            registrationListener?.let { nsdManager?.unregisterService(it) }
        } catch (_: Exception) {
        }
        registrationListener = null
        registerNsd()
    }

    private fun releaseLocks() {
        try {
            wifiLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {
        }
        wifiLock = null
        try {
            multicastLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {
        }
        multicastLock = null
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {
        }
        wakeLock = null
    }

    private fun ensureForeground(text: String) {
        val notification = buildNotification(text)
        if (!foregroundReady) {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            foregroundReady = true
        } else {
            getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(text: String): Notification {
        val channelId = "aspera_companion"
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel(
                    channelId,
                    "Aspera Companion",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply {
                    description = "Keeps click-to-call working when the app is closed"
                    setShowBadge(false)
                },
            )
        }
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, CompanionService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("Aspera Connect is running")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentIntent(open)
            .addAction(0, "Stop", stop)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun broadcastStatus(status: String, pcName: String?) {
        linkedPcName = pcName
        lastStatus = status
        sendBroadcast(
            Intent(ACTION_STATUS).apply {
                setPackage(packageName)
                putExtra(EXTRA_STATUS, status)
                putExtra(EXTRA_PC_NAME, pcName)
                putExtra(EXTRA_IP, lastLocalIp ?: guessLocalIpv4(this@CompanionService))
            },
        )
    }

    private fun registerNsd() {
        if (registrationListener != null) return
        try {
            nsdManager = getSystemService(NsdManager::class.java)
            val serviceInfo = NsdServiceInfo().apply {
                serviceName = "AsperaConnect-${Build.MODEL.replace(" ", "")}"
                serviceType = SERVICE_TYPE
                port = PORT
            }
            registrationListener = object : NsdManager.RegistrationListener {
                override fun onServiceRegistered(info: NsdServiceInfo) {
                    Log.i(TAG, "NSD registered: ${info.serviceName}")
                }
                override fun onRegistrationFailed(info: NsdServiceInfo, code: Int) {
                    Log.w(TAG, "NSD registration failed: $code")
                }
                override fun onServiceUnregistered(info: NsdServiceInfo) {}
                override fun onUnregistrationFailed(info: NsdServiceInfo, code: Int) {}
            }
            nsdManager?.registerService(
                serviceInfo,
                NsdManager.PROTOCOL_DNS_SD,
                registrationListener,
            )
        } catch (e: Exception) {
            Log.w(TAG, "NSD setup failed: ${e.message}")
        }
    }

    private suspend fun serve() {
        ServerSocket(PORT).use { server ->
            Log.i(TAG, "Companion listening on $PORT")
            while (scope.isActive) {
                val socket = server.accept()
                scope.launch { handleClient(socket) }
            }
        }
    }

    private fun handleClient(socket: Socket) {
        socket.soTimeout = 0
        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
        val writer = BufferedWriter(OutputStreamWriter(socket.getOutputStream()))
        val pin = pinRef.get()
        var authed = false
        var pcLabel: String? = null
        try {
            while (true) {
                val line = reader.readLine() ?: break
                val msg = JSONObject(line)
                when (msg.optString("type")) {
                    "hello" -> {
                        val offered = msg.optString("pin", "")
                        val ok = pin.isNullOrBlank() || pin == offered
                        pcLabel = msg.optString("name", "").ifBlank { "PC" }
                        val ack = JSONObject()
                            .put("type", "helloAck")
                            .put("ok", ok)
                            .put("protocol", PROTOCOL)
                            .put(
                                "capabilities",
                                JSONObject()
                                    .put("placeCall", true)
                                    .put("endCall", true)
                                    .put("contacts", true)
                                    .put("mirror", false)
                                    .put("input", false),
                            )
                            .put("reason", if (ok) JSONObject.NULL else "bad_pin")
                            .put("model", Build.MODEL)
                            .put("ip", guessLocalIpv4(this@CompanionService) ?: JSONObject.NULL)
                        writer.write(ack.toString())
                        writer.newLine()
                        writer.flush()
                        authed = ok
                        if (ok) {
                            linkedClients.incrementAndGet()
                            ensureForeground("Linked to $pcLabel — click-to-call ready")
                            broadcastStatus(STATUS_LINKED, pcLabel)
                        } else {
                            broadcastStatus(STATUS_FAILED, pcLabel)
                            break
                        }
                    }
                    "placeCall" -> {
                        if (!authed) {
                            writeErr(writer, "not_authed")
                            continue
                        }
                        val number = msg.optString("number", "")
                        val direct = msg.optBoolean("direct", true)
                        val result = placeCall(number, direct)
                        val ack = JSONObject()
                            .put("type", "placeCallAck")
                            .put("ok", result.first)
                            .put("message", result.second)
                        writer.write(ack.toString())
                        writer.newLine()
                        writer.flush()
                    }
                    "endCall" -> {
                        if (!authed) {
                            writeErr(writer, "not_authed")
                            continue
                        }
                        val result = endCall()
                        val ack = JSONObject()
                            .put("type", "endCallAck")
                            .put("ok", result.first)
                            .put("message", result.second)
                        writer.write(ack.toString())
                        writer.newLine()
                        writer.flush()
                    }
                    "ping" -> {
                        writer.write(JSONObject().put("type", "pong").toString())
                        writer.newLine()
                        writer.flush()
                    }
                    "listContacts" -> {
                        if (!authed) {
                            writeErr(writer, "not_authed")
                            continue
                        }
                        val (ok, contacts) = ContactReader.listContacts(this@CompanionService)
                        val ack = JSONObject()
                            .put("type", "contacts")
                            .put("ok", ok)
                            .put("contacts", contacts)
                            .put(
                                "reason",
                                if (ok) JSONObject.NULL else "need_contacts_permission",
                            )
                        writer.write(ack.toString())
                        writer.newLine()
                        writer.flush()
                    }
                    "startMirror", "stopMirror", "input" -> {
                        if (authed) writeErr(writer, "mirror_removed")
                    }
                    "stop" -> break
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "client error: ${e.message}")
        } finally {
            try {
                socket.close()
            } catch (_: Exception) {
            }
            if (authed) {
                val left = linkedClients.decrementAndGet().coerceAtLeast(0)
                if (left == 0) {
                    refreshLocalIp("client disconnected")
                    ensureForeground("Listening for PC — ${lastLocalIp ?: "Wi‑Fi"}:$PORT")
                    broadcastStatus(STATUS_LISTENING, null)
                }
            }
        }
    }

    private fun writeErr(writer: BufferedWriter, reason: String) {
        try {
            writer.write(
                JSONObject()
                    .put("type", "error")
                    .put("reason", reason)
                    .toString(),
            )
            writer.newLine()
            writer.flush()
        } catch (_: Exception) {
        }
    }

    private fun endCall(): Pair<Boolean, String> {
        return try {
            if (Build.VERSION.SDK_INT < 28) {
                return false to "Hang up needs Android 9+"
            }
            val tm = getSystemService(android.telecom.TelecomManager::class.java)
            @Suppress("DEPRECATION")
            val ended = tm.endCall()
            if (ended) {
                ensureForeground("Call ended from PC")
                try {
                    getSystemService(NotificationManager::class.java)
                        .cancel(CALL_NOTIFICATION_ID)
                } catch (_: Exception) {
                }
                true to "Call ended"
            } else {
                false to "No active call to end (or permission denied)"
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "endCall denied: ${e.message}")
            false to "Allow Phone / Answer calls on the companion app, then try Hang up again"
        } catch (e: Exception) {
            Log.w(TAG, "endCall failed: ${e.message}")
            false to (e.message ?: "Hang up failed")
        }
    }

    private fun placeCall(raw: String, direct: Boolean): Pair<Boolean, String> {
        val number = raw.filter { it.isDigit() || it == '+' }
        if (number.length < 3) return false to "invalid_number"

        // 1) Preferred: TelecomManager works from background with CALL_PHONE
        //    (startActivity(ACTION_CALL) is blocked when the app UI is not visible).
        if (direct) {
            try {
                val tm = getSystemService(android.telecom.TelecomManager::class.java)
                tm.placeCall(Uri.parse("tel:$number"), android.os.Bundle())
                ensureForeground("Calling $number…")
                postCallNotification(number, direct)
                return true to "Calling $number"
            } catch (e: SecurityException) {
                Log.w(TAG, "Telecom placeCall denied: ${e.message}")
            } catch (e: Exception) {
                Log.w(TAG, "Telecom placeCall failed: ${e.message}")
            }
        }

        // 2) High-priority notification / full-screen trampoline (works when UI is closed)
        postCallNotification(number, direct)

        // 3) Best-effort direct startActivity (only works if Android allows BAL)
        return try {
            val action = if (direct) Intent.ACTION_CALL else Intent.ACTION_DIAL
            val intent = Intent(action, Uri.parse("tel:$number")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
            true to if (direct) "Calling $number" else "Opened dialer for $number"
        } catch (e: SecurityException) {
            try {
                startActivity(
                    Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
                true to "Opened dialer for $number (grant Phone permission for direct call)"
            } catch (e2: Exception) {
                // Notification trampoline still posted — user can tap Call
                true to "Tap the Call notification on the phone for $number"
            }
        } catch (e: Exception) {
            true to "Tap the Call notification on the phone for $number"
        }
    }

    private fun postCallNotification(number: String, direct: Boolean) {
        val channelId = "aspera_calls"
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel(
                    channelId,
                    "Aspera calls",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Outgoing Hub / PC click-to-call"
                    setSound(null, null)
                },
            )
        }

        val trampoline = Intent(this, CallTrampolineActivity::class.java).apply {
            putExtra(CallTrampolineActivity.EXTRA_NUMBER, number)
            putExtra(CallTrampolineActivity.EXTRA_DIRECT, direct)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val fullScreen = PendingIntent.getActivity(
            this,
            number.hashCode(),
            trampoline,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val tap = PendingIntent.getActivity(
            this,
            number.hashCode() + 1,
            trampoline,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Calling $number")
            .setContentText("From PC / Hub — tap if the call did not start")
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentIntent(tap)
            .setFullScreenIntent(fullScreen, true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setTimeoutAfter(30_000)
            .addAction(0, "Call", tap)
            .build()
        nm.notify(CALL_NOTIFICATION_ID, notification)
    }

    override fun onDestroy() {
        running.set(false)
        linkedClients.set(0)
        serverJob?.cancel()
        unregisterNetworkCallback()
        try {
            registrationListener?.let { nsdManager?.unregisterService(it) }
        } catch (_: Exception) {
        }
        registrationListener = null
        releaseLocks()
        lastLocalIp = null
        linkedPcName = null
        broadcastStatus(STATUS_STOPPED, null)
        foregroundReady = false
        instance = null
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        @Volatile
        var instance: CompanionService? = null
            private set

        const val EXTRA_PIN = "pin"
        const val ACTION_STOP = "com.asperaconnect.companion.STOP"
        const val ACTION_STATUS = "com.asperaconnect.companion.STATUS"
        const val EXTRA_STATUS = "status"
        const val EXTRA_PC_NAME = "pcName"
        const val EXTRA_IP = "ip"
        const val STATUS_LISTENING = "listening"
        const val STATUS_LINKED = "linked"
        const val STATUS_FAILED = "failed"
        const val STATUS_STOPPED = "stopped"
        const val PORT = 17891
        const val PROTOCOL = 1
        const val SERVICE_TYPE = "_aspera-connect._tcp."
        private const val NOTIFICATION_ID = 41
        private const val CALL_NOTIFICATION_ID = 44
        private const val TAG = "AsperaCompanion"
        private const val PREFS = "aspera_companion"
        private const val PREF_WANT_LISTEN = "want_listen"

        @Volatile
        var lastLocalIp: String? = null
            private set

        @Volatile
        var linkedPcName: String? = null
            private set

        @Volatile
        var lastStatus: String = STATUS_STOPPED
            private set

        fun isRunning(): Boolean = lastStatus == STATUS_LISTENING || lastStatus == STATUS_LINKED

        fun start(context: Context, pin: String?) {
            val intent = Intent(context, CompanionService::class.java).apply {
                putExtra(EXTRA_PIN, pin)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(PREF_WANT_LISTEN, false)
                .apply()
            val intent = Intent(context, CompanionService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
            context.stopService(Intent(context, CompanionService::class.java))
        }

        fun guessLocalIpv4(context: Context? = null): String? {
            context?.let { ctx ->
                try {
                    val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                    val network = cm?.activeNetwork ?: return@let
                    val props = cm.getLinkProperties(network) ?: return@let
                    for (la in props.linkAddresses) {
                        val addr = la.address
                        if (addr is Inet4Address && !addr.isLoopbackAddress && !addr.isLinkLocalAddress) {
                            return addr.hostAddress
                        }
                    }
                } catch (_: Exception) {
                }
            }
            return try {
                NetworkInterface.getNetworkInterfaces()?.toList()
                    ?.sortedBy { iface ->
                        when {
                            iface.name.startsWith("wlan") -> 0
                            iface.name.startsWith("eth") -> 1
                            else -> 2
                        }
                    }
                    ?.flatMap { it.inetAddresses.toList() }
                    ?.firstOrNull { addr ->
                        addr is Inet4Address &&
                            !addr.isLoopbackAddress &&
                            !addr.isLinkLocalAddress
                    }
                    ?.hostAddress
            } catch (_: Exception) {
                null
            }
        }
    }
}
