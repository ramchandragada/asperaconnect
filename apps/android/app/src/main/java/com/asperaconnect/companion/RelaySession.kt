package com.asperaconnect.companion

import android.os.Build
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Cross-network link via Aspera cloud relay (WhatsApp-style).
 * Phone dials OUT — works on any network with internet.
 */
object RelaySession {
    private const val TAG = "AsperaRelay"
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var socket: WebSocket? = null

    @Volatile
    var linked: Boolean = false
        private set

    @Volatile
    var pcName: String? = null
        private set

    fun disconnect() {
        linked = false
        pcName = null
        try {
            socket?.close(1000, "stop")
        } catch (_: Exception) {
        }
        socket = null
    }

    fun joinFromQr(
        offer: QrPairing.CloudOffer,
        onPaired: (Boolean, String) -> Unit,
        onCommand: (JSONObject, (JSONObject) -> Unit) -> Unit,
    ) {
        disconnect()
        val latch = CountDownLatch(1)
        val joinResult = AtomicReference<Pair<Boolean, String>?>(null)
        var url = offer.relayUrl.trim()
        if (url.startsWith("https://")) url = "wss://" + url.removePrefix("https://")
        if (url.startsWith("http://")) url = "ws://" + url.removePrefix("http://")

        val req = Request.Builder().url(url).build()
        socket = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val join = JSONObject()
                    .put("type", "join")
                    .put("role", "phone")
                    .put("sessionId", offer.sessionId)
                    .put("secret", offer.secret)
                    .put("name", Build.MODEL)
                webSocket.send(join.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val msg = JSONObject(text)
                    when (val type = msg.optString("type")) {
                        "joined" -> {
                            if (!msg.optBoolean("ok", false) && latch.count > 0) {
                                joinResult.set(false to msg.optString("reason", "join_failed"))
                                latch.countDown()
                            }
                        }
                        "paired" -> {
                            linked = true
                            pcName = msg.optString("pcName", "PC")
                            if (latch.count > 0) {
                                joinResult.set(true to "Linked to $pcName over internet")
                                latch.countDown()
                            }
                        }
                        "ping" -> webSocket.send(JSONObject().put("type", "pong").toString())
                        "placeCall", "endCall", "listContacts", "hello" -> {
                            onCommand(msg) { ack -> webSocket.send(ack.toString()) }
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
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                linked = false
            }
        })

        latch.await(25, TimeUnit.SECONDS)
        val result = joinResult.get() ?: (false to "Timed out joining relay")
        onPaired(result.first, result.second)
    }
}
