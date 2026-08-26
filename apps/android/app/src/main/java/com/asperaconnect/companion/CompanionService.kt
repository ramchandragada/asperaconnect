package com.asperaconnect.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
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
 * Does not require Developer Options / USB debugging / MediaProjection.
 */
class CompanionService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var serverJob: Job? = null
    private val running = AtomicBoolean(false)
    private var nsdManager: NsdManager? = null
    private var registrationListener: NsdManager.RegistrationListener? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    private val pinRef = AtomicReference<String?>(null)
    private val linkedClients = AtomicInteger(0)
    private var foregroundReady = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                pinRef.set(intent?.getStringExtra(EXTRA_PIN))
                ensureForeground("Listening for PC — ${guessLocalIpv4() ?: "Wi‑Fi"}:$PORT")
                registerNsd()
                if (running.compareAndSet(false, true)) {
                    serverJob = scope.launch { serve() }
                }
                lastLocalIp = guessLocalIpv4()
                linkedPcName = null
                broadcastStatus(STATUS_LISTENING, null)
            }
        }
        return START_STICKY
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
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
        }
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("Aspera Connect")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentIntent(open)
            .setOngoing(true)
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
                putExtra(EXTRA_IP, lastLocalIp ?: guessLocalIpv4())
            },
        )
    }

    private fun registerNsd() {
        try {
            val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            multicastLock = wifi.createMulticastLock("aspera-companion").apply {
                setReferenceCounted(true)
                acquire()
            }
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
                            .put("capabilities", JSONObject().put("placeCall", true))
                            .put("reason", if (ok) JSONObject.NULL else "bad_pin")
                            .put("model", Build.MODEL)
                            .put("ip", guessLocalIpv4() ?: JSONObject.NULL)
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
                    "ping" -> {
                        writer.write(JSONObject().put("type", "pong").toString())
                        writer.newLine()
                        writer.flush()
                    }
                    "startMirror" -> {
                        val ack = JSONObject()
                            .put("type", "mirrorReady")
                            .put("ok", false)
                            .put("reason", "mirror_not_enabled_yet")
                            .put("port", VIDEO_PORT)
                        writer.write(ack.toString())
                        writer.newLine()
                        writer.flush()
                    }
                    "input" -> {
                        if (authed) AsperaAccessibilityService.dispatch(msg)
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
                    ensureForeground("Listening for PC — ${guessLocalIpv4() ?: "Wi‑Fi"}:$PORT")
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

    private fun placeCall(raw: String, direct: Boolean): Pair<Boolean, String> {
        val number = raw.filter { it.isDigit() || it == '+' }
        if (number.length < 3) return false to "invalid_number"
        return try {
            val action = if (direct) Intent.ACTION_CALL else Intent.ACTION_DIAL
            val intent = Intent(action, Uri.parse("tel:$number")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
            true to if (direct) "Calling $number" else "Opened dialer for $number"
        } catch (e: SecurityException) {
            try {
                val dial = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number")).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(dial)
                true to "Opened dialer for $number (grant Phone permission for direct call)"
            } catch (e2: Exception) {
                false to (e2.message ?: "call_failed")
            }
        } catch (e: Exception) {
            false to (e.message ?: "call_failed")
        }
    }

    override fun onDestroy() {
        running.set(false)
        linkedClients.set(0)
        serverJob?.cancel()
        scope.cancel()
        try {
            registrationListener?.let { nsdManager?.unregisterService(it) }
        } catch (_: Exception) {
        }
        try {
            multicastLock?.release()
        } catch (_: Exception) {
        }
        lastLocalIp = null
        linkedPcName = null
        broadcastStatus(STATUS_STOPPED, null)
        foregroundReady = false
        super.onDestroy()
    }

    companion object {
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
        const val VIDEO_PORT = 17892
        const val PROTOCOL = 1
        const val SERVICE_TYPE = "_aspera-connect._tcp."
        private const val NOTIFICATION_ID = 41
        private const val TAG = "AsperaCompanion"

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
            val intent = Intent(context, CompanionService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
            context.stopService(Intent(context, CompanionService::class.java))
        }

        fun guessLocalIpv4(): String? {
            return try {
                NetworkInterface.getNetworkInterfaces()?.toList()
                    ?.flatMap { it.inetAddresses.toList() }
                    ?.firstOrNull { addr ->
                        addr is Inet4Address && !addr.isLoopbackAddress
                    }
                    ?.hostAddress
            } catch (_: Exception) {
                null
            }
        }
    }
}
