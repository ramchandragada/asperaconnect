package com.asperaconnect.companion

import android.content.Context
import android.os.Build
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * Cross-network link via Aspera cloud relay (WhatsApp-style).
 * Pair once; credentials are saved and the phone auto-rejoins.
 */
object RelaySession {
    private const val TAG = "AsperaRelay"
    private const val PREFS = "aspera_relay"
    private const val KEY_URL = "relay_url"
    private const val KEY_SESSION = "session_id"
    private const val KEY_SECRET = "secret"

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private val scheduler = Executors.newSingleThreadScheduledExecutor()

    @Volatile
    private var socket: WebSocket? = null

    @Volatile
    var linked: Boolean = false
        private set

    @Volatile
    var pcName: String? = null
        private set

    private var commandHandler: ((JSONObject, (JSONObject) -> Unit) -> Unit)? = null
    private var statusHandler: ((Boolean, String) -> Unit)? = null
    private val reconnecting = AtomicBoolean(false)
    private val wantLink = AtomicBoolean(false)
    private val backoffSec = AtomicInteger(2)
    private var reconnectFuture: ScheduledFuture<*>? = null
    private var appContext: Context? = null

    /** Stop socket; keep saved pair unless [clearSaved]. */
    fun disconnect(clearSaved: Boolean = false) {
        wantLink.set(false)
        linked = false
        pcName = null
        reconnectFuture?.cancel(false)
        reconnectFuture = null
        reconnecting.set(false)
        try {
            socket?.close(1000, "stop")
        } catch (_: Exception) {
        }
        socket = null
        if (clearSaved) {
            appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)?.edit()?.clear()?.apply()
        }
    }

    fun hasSavedPair(context: Context): Boolean {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return !p.getString(KEY_SESSION, null).isNullOrBlank() &&
            !p.getString(KEY_SECRET, null).isNullOrBlank() &&
            !p.getString(KEY_URL, null).isNullOrBlank()
    }

    /** Restore one-time pair after app/service restart. */
    fun resumeSaved(
        context: Context,
        onStatus: (Boolean, String) -> Unit,
        onCommand: (JSONObject, (JSONObject) -> Unit) -> Unit,
    ) {
        appContext = context.applicationContext
        statusHandler = onStatus
        commandHandler = onCommand
        if (!hasSavedPair(context)) return
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val url = p.getString(KEY_URL, null) ?: return
        val sessionId = p.getString(KEY_SESSION, null) ?: return
        val secret = p.getString(KEY_SECRET, null) ?: return
        wantLink.set(true)
        connect(url, sessionId, secret, rejoin = true, latchTimeoutSec = 20) { ok, msg ->
            onStatus(ok, msg)
            if (!ok) scheduleReconnect()
        }
    }

    fun joinFromQr(
        context: Context,
        offer: QrPairing.CloudOffer,
        onPaired: (Boolean, String) -> Unit,
        onCommand: (JSONObject, (JSONObject) -> Unit) -> Unit,
    ) {
        appContext = context.applicationContext
        commandHandler = onCommand
        statusHandler = onPaired
        reconnectFuture?.cancel(false)
        reconnectFuture = null
        reconnecting.set(false)
        // Close old socket without clearing credentials / without scheduling reconnect.
        wantLink.set(false)
        try {
            socket?.close(1000, "re-pair")
        } catch (_: Exception) {
        }
        socket = null
        linked = false

        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_URL, offer.relayUrl.trim())
            .putString(KEY_SESSION, offer.sessionId)
            .putString(KEY_SECRET, offer.secret)
            .apply()
        backoffSec.set(2)
        wantLink.set(true)
        connect(offer.relayUrl, offer.sessionId, offer.secret, rejoin = false, latchTimeoutSec = 25, onPaired)
    }

    private fun scheduleReconnect() {
        if (!wantLink.get()) return
        if (!reconnecting.compareAndSet(false, true)) return
        val ctx = appContext ?: run {
            reconnecting.set(false)
            return
        }
        if (!hasSavedPair(ctx)) {
            reconnecting.set(false)
            return
        }
        val delay = backoffSec.get().toLong().coerceAtMost(60)
        backoffSec.updateAndGet { (it * 2).coerceAtMost(60) }
        reconnectFuture = scheduler.schedule({
            reconnecting.set(false)
            if (!wantLink.get()) return@schedule
            resumeSaved(
                ctx,
                statusHandler ?: { _, _ -> },
                commandHandler ?: { _, _ -> },
            )
        }, delay, TimeUnit.SECONDS)
    }

    private fun connect(
        relayUrl: String,
        sessionId: String,
        secret: String,
        rejoin: Boolean,
        latchTimeoutSec: Long,
        onPaired: (Boolean, String) -> Unit,
    ) {
        val latch = CountDownLatch(1)
        val joinResult = AtomicReference<Pair<Boolean, String>?>(null)
        var url = relayUrl.trim()
        if (url.startsWith("https://")) url = "wss://" + url.removePrefix("https://")
        if (url.startsWith("http://")) url = "ws://" + url.removePrefix("http://")

        val req = Request.Builder().url(url).build()
        socket = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val msg = JSONObject()
                    .put("type", if (rejoin) "rejoin" else "join")
                    .put("role", "phone")
                    .put("sessionId", sessionId)
                    .put("secret", secret)
                    .put("name", Build.MODEL)
                webSocket.send(msg.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val msg = JSONObject(text)
                    when (val type = msg.optString("type")) {
                        "joined", "rejoined" -> {
                            val ok = msg.optBoolean("ok", false)
                            if (!ok && latch.count > 0) {
                                joinResult.set(false to msg.optString("reason", "join_failed"))
                                latch.countDown()
                            } else if (ok && rejoin && latch.count > 0) {
                                // Saved pair restored even if PC is briefly offline.
                                linked = true
                                pcName = msg.optString("pcName", pcName ?: "PC")
                                joinResult.set(true to "Reconnected (saved pair)")
                                latch.countDown()
                                backoffSec.set(2)
                            } else if (ok && !rejoin) {
                                // Wait for "paired" on first join.
                            }
                        }
                        "paired" -> {
                            linked = true
                            pcName = msg.optString("pcName", "PC")
                            if (latch.count > 0) {
                                joinResult.set(true to "Linked to $pcName — pair saved, no need to scan again")
                                latch.countDown()
                            }
                            backoffSec.set(2)
                            statusHandler?.invoke(true, "Linked to $pcName")
                        }
                        "peer_disconnected" -> {
                            linked = false
                            statusHandler?.invoke(false, "PC disconnected — will auto-reconnect")
                        }
                        "ping" -> webSocket.send(JSONObject().put("type", "pong").toString())
                        "placeCall", "endCall", "listContacts", "hello" -> {
                            commandHandler?.invoke(msg) { ack -> webSocket.send(ack.toString()) }
                        }
                        else -> Log.d(TAG, "ignore $type")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "msg: ${e.message}")
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "ws fail: ${t.message}")
                linked = false
                if (latch.count > 0) {
                    joinResult.set(false to (t.message ?: "Relay connection failed"))
                    latch.countDown()
                }
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                linked = false
                scheduleReconnect()
            }
        })

        latch.await(latchTimeoutSec, TimeUnit.SECONDS)
        val result = joinResult.get() ?: (false to "Timed out joining relay")
        onPaired(result.first, result.second)
    }
}
