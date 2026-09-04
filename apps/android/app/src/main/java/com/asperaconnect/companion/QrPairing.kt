package com.asperaconnect.companion

import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetSocketAddress
import java.net.Socket

/** Parse PC QR (`aspera1:` LAN or `aspera2:` internet) and register with the PC. */
object QrPairing {
    private const val TAG = "AsperaQrPair"
    private const val PREFIX_LAN = "aspera1:"
    private const val PREFIX_CLOUD = "aspera2:"

    data class Offer(
        val token: String,
        val port: Int,
        val hosts: List<String>,
        val pcName: String,
    )

    data class CloudOffer(
        val relayUrl: String,
        val sessionId: String,
        val secret: String,
        val pcName: String,
    )

    data class Result(
        val ok: Boolean,
        val message: String,
        val pcName: String? = null,
    )

    sealed class Parsed {
        data class Lan(val offer: Offer) : Parsed()
        data class Cloud(val offer: CloudOffer) : Parsed()
    }

    fun parseAny(raw: String): Parsed? {
        val text = raw.trim()
        if (text.startsWith(PREFIX_CLOUD) || (text.startsWith("{") && text.contains("\"v\":2"))) {
            return parseCloud(text)?.let { Parsed.Cloud(it) }
        }
        return parsePayload(text)?.let { Parsed.Lan(it) }
    }

    fun parseCloud(raw: String): CloudOffer? {
        val jsonText = when {
            raw.startsWith(PREFIX_CLOUD) -> raw.removePrefix(PREFIX_CLOUD)
            raw.startsWith("{") -> raw
            else -> return null
        }
        return try {
            val o = JSONObject(jsonText)
            if (o.optInt("v", 0) != 2) return null
            val relay = o.optString("r", "")
            val session = o.optString("s", "")
            val secret = o.optString("k", "")
            if (relay.isBlank() || session.isBlank() || secret.isBlank()) return null
            CloudOffer(
                relayUrl = relay,
                sessionId = session,
                secret = secret,
                pcName = o.optString("n", "PC"),
            )
        } catch (e: Exception) {
            Log.w(TAG, "cloud parse: ${e.message}")
            null
        }
    }

    fun parsePayload(raw: String): Offer? {
        val text = raw.trim()
        val jsonText = when {
            text.startsWith(PREFIX_LAN) -> text.removePrefix(PREFIX_LAN)
            text.startsWith("{") -> text
            else -> return null
        }
        return try {
            val o = JSONObject(jsonText)
            if (o.optInt("v", 0) != 1) return null
            val token = o.optString("t", "")
            val port = o.optInt("p", 17892)
            val hostsJson = o.optJSONArray("h") ?: return null
            val hosts = buildList {
                for (i in 0 until hostsJson.length()) {
                    val h = hostsJson.optString(i)
                    if (h.isNotBlank()) add(h)
                }
            }
            if (token.isBlank() || hosts.isEmpty()) return null
            Offer(token = token, port = port, hosts = hosts, pcName = o.optString("n", "PC"))
        } catch (e: Exception) {
            Log.w(TAG, "parse: ${e.message}")
            null
        }
    }

    fun pairWithPc(offer: Offer, phoneIp: String): Result {
        val body = JSONObject()
            .put("type", "pair")
            .put("token", offer.token)
            .put("phoneIp", phoneIp)
            .put("phonePort", CompanionService.PORT)
            .put("name", Build.MODEL)
            .toString() + "\n"

        var lastErr = "Could not reach PC"
        for (host in offer.hosts) {
            try {
                val socket = Socket()
                try {
                    socket.soTimeout = 4000
                    socket.connect(InetSocketAddress(host, offer.port), 2500)
                    val writer = BufferedWriter(OutputStreamWriter(socket.getOutputStream()))
                    val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                    writer.write(body)
                    writer.flush()
                    val line = reader.readLine()
                    if (line.isNullOrBlank()) {
                        lastErr = "Empty reply from PC"
                    } else {
                        val ack = JSONObject(line)
                        if (ack.optBoolean("ok", false)) {
                            return Result(true, "Paired with ${offer.pcName}", offer.pcName)
                        }
                        lastErr = ack.optString("reason", "PC rejected pair")
                    }
                } finally {
                    try {
                        socket.close()
                    } catch (_: Exception) {
                    }
                }
            } catch (e: Exception) {
                lastErr = e.message ?: "Connection failed"
                Log.w(TAG, "pair $host: ${e.message}")
            }
        }
        return Result(
            false,
            "$lastErr — phone and PC must be on the same network (same router as the PC LAN/Wi‑Fi).",
        )
    }
}
