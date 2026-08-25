package com.asperaconnect.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.util.Log
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
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Easy-mode control plane on TCP 17891.
 * Broadcasts phone notifications to connected desktop clients.
 */
class MirrorService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var serverJob: Job? = null
    private var projection: android.media.projection.MediaProjection? = null
    private val running = AtomicBoolean(false)
    private var nsdManager: NsdManager? = null
    private var registrationListener: NsdManager.RegistrationListener? = null
    private var multicastLock: WifiManager.MulticastLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        val data = if (Build.VERSION.SDK_INT >= 33) {
            intent?.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent?.getParcelableExtra(EXTRA_RESULT_DATA)
        }
        val pin = intent?.getStringExtra(EXTRA_PIN)

        startForeground(NOTIFICATION_ID, buildNotification())
        if (data != null) {
            val mpm = getSystemService(MediaProjectionManager::class.java)
            projection = mpm.getMediaProjection(resultCode, data)
        }

        registerNsd()

        if (running.compareAndSet(false, true)) {
            serverJob = scope.launch { serve(pin) }
        }
        return START_STICKY
    }

    private fun registerNsd() {
        try {
            val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            multicastLock = wifi.createMulticastLock("aspera-connect").apply {
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
            nsdManager?.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener)
        } catch (e: Exception) {
            Log.w(TAG, "NSD setup failed: ${e.message}")
        }
    }

    private suspend fun serve(pin: String?) {
        ServerSocket(PORT).use { server ->
            Log.i(TAG, "Companion listening on $PORT")
            while (scope.isActive) {
                val socket = server.accept()
                launch { handleClient(socket, pin) }
            }
        }
    }

    private fun handleClient(socket: Socket, pin: String?) {
        socket.soTimeout = 0
        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
        val writer = BufferedWriter(OutputStreamWriter(socket.getOutputStream()))
        try {
            val line = reader.readLine() ?: return
            val msg = JSONObject(line)
            when (msg.optString("type")) {
                "hello" -> {
                    val offered = msg.optString("pin", "")
                    val ok = pin.isNullOrBlank() || pin == offered
                    val ack = JSONObject()
                        .put("type", "helloAck")
                        .put("ok", ok)
                        .put("protocol", PROTOCOL)
                        .put("reason", if (ok) JSONObject.NULL else "bad_pin")
                    writer.write(ack.toString())
                    writer.newLine()
                    writer.flush()
                    if (!ok) return
                    clients.add(writer)
                }
                "startMirror" -> {
                    val ack = JSONObject().put("type", "mirrorReady").put("port", VIDEO_PORT)
                    writer.write(ack.toString())
                    writer.newLine()
                    writer.flush()
                }
            }
            while (true) {
                val next = reader.readLine() ?: break
                val m = JSONObject(next)
                when (m.optString("type")) {
                    "input" -> AsperaAccessibilityService.dispatch(m)
                    "stopMirror" -> break
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "client error: ${e.message}")
        } finally {
            clients.remove(writer)
            try {
                socket.close()
            } catch (_: Exception) {}
        }
    }

    private fun buildNotification(): Notification {
        val channelId = "aspera_mirror"
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel(channelId, "Aspera mirroring", NotificationManager.IMPORTANCE_LOW),
            )
        }
        return if (Build.VERSION.SDK_INT >= 26) {
            Notification.Builder(this, channelId)
                .setContentTitle("Aspera Connect")
                .setContentText("Easy mode listening on port $PORT")
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("Aspera Connect")
                .setContentText("Easy mode listening on port $PORT")
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .build()
        }
    }

    override fun onDestroy() {
        running.set(false)
        serverJob?.cancel()
        scope.cancel()
        projection?.stop()
        projection = null
        clients.clear()
        try {
            registrationListener?.let { nsdManager?.unregisterService(it) }
        } catch (_: Exception) {}
        try {
            multicastLock?.release()
        } catch (_: Exception) {}
        super.onDestroy()
    }

    companion object {
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val EXTRA_PIN = "pin"
        const val PORT = 17891
        const val VIDEO_PORT = 17892
        const val PROTOCOL = 1
        const val SERVICE_TYPE = "_aspera-connect._tcp."
        private const val NOTIFICATION_ID = 42
        private const val TAG = "AsperaMirror"

        private val clients =
            Collections.synchronizedSet(mutableSetOf<BufferedWriter>())

        fun broadcast(jsonLine: String) {
            synchronized(clients) {
                clients.forEach { writer ->
                    try {
                        writer.write(jsonLine)
                        writer.newLine()
                        writer.flush()
                    } catch (_: Exception) {
                        clients.remove(writer)
                    }
                }
            }
        }
    }
}
