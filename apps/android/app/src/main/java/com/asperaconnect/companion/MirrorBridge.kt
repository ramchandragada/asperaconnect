package com.asperaconnect.companion

import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.util.Log
import android.view.Surface
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Shares MediaProjection and runs H.264 TCP stream on [VIDEO_PORT] for Easy-mode mirror.
 */
object MirrorBridge {
    const val VIDEO_PORT = 17892

    @Volatile
    var projection: MediaProjection? = null
        private set

    @Volatile
    var width: Int = 0
        private set

    @Volatile
    var height: Int = 0
        private set

    private val streaming = AtomicBoolean(false)
    private var encoderThread: Thread? = null
    private var serverSocket: ServerSocket? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var codec: MediaCodec? = null
    private var inputSurface: Surface? = null

    fun setProjection(p: MediaProjection?) {
        projection = p
    }

    fun isStreaming(): Boolean = streaming.get()

    fun hasProjection(): Boolean = projection != null

    /**
     * Start (or keep) H.264 server. Returns false if screen capture was not granted yet.
     * Binds [VIDEO_PORT] before returning so the PC can connect immediately.
     */
    @Synchronized
    fun startStreaming(densityDpi: Int, screenWidth: Int, screenHeight: Int): Boolean {
        val proj = projection ?: return false
        if (streaming.get()) return true

        val longEdge = 1280
        val scale = min(1f, longEdge.toFloat() / maxOf(screenWidth, screenHeight))
        width = (screenWidth * scale).roundToInt().coerceAtLeast(2) and 1.inv()
        height = (screenHeight * scale).roundToInt().coerceAtLeast(2) and 1.inv()

        val server = try {
            ServerSocket().apply {
                reuseAddress = true
                bind(InetSocketAddress(VIDEO_PORT))
            }
        } catch (e: Exception) {
            Log.e(TAG, "bind $VIDEO_PORT failed: ${e.message}")
            return false
        }
        serverSocket = server
        streaming.set(true)
        encoderThread = thread(name = "aspera-h264", isDaemon = true) {
            runEncoder(proj, densityDpi, server)
        }
        return true
    }

    @Synchronized
    fun stopStreaming() {
        streaming.set(false)
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        try {
            encoderThread?.join(2000)
        } catch (_: Exception) {
        }
        encoderThread = null
        releaseEncoder()
    }

    private fun runEncoder(proj: MediaProjection, densityDpi: Int, server: ServerSocket) {
        var client: Socket? = null
        try {
            val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
                setInteger(
                    MediaFormat.KEY_COLOR_FORMAT,
                    MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface,
                )
                setInteger(MediaFormat.KEY_BIT_RATE, 3_500_000)
                setInteger(MediaFormat.KEY_FRAME_RATE, 30)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    setInteger(MediaFormat.KEY_LATENCY, 0)
                }
            }
            val enc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            enc.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            val surface = enc.createInputSurface()
            enc.start()
            codec = enc
            inputSurface = surface

            virtualDisplay = proj.createVirtualDisplay(
                "AsperaEasyMirror",
                width,
                height,
                densityDpi.coerceAtLeast(160),
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                surface,
                null,
                null,
            )
            Log.i(TAG, "H.264 ready on $VIDEO_PORT (${width}x$height)")

            while (streaming.get()) {
                try {
                    server.soTimeout = 1000
                    client = try {
                        server.accept()
                    } catch (_: java.net.SocketTimeoutException) {
                        continue
                    }
                    client.tcpNoDelay = true
                    Log.i(TAG, "Easy mirror client connected")
                    // Ask for a keyframe so the player can start quickly.
                    try {
                        if (android.os.Build.VERSION.SDK_INT >= 23) {
                            val params = android.os.Bundle()
                            params.putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0)
                            enc.setParameters(params)
                        }
                    } catch (_: Exception) {
                    }
                    pumpFrames(enc, client.getOutputStream())
                } catch (e: Exception) {
                    if (streaming.get()) Log.w(TAG, "client loop: ${e.message}")
                } finally {
                    try {
                        client?.close()
                    } catch (_: Exception) {
                    }
                    client = null
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "encoder failed: ${e.message}", e)
        } finally {
            releaseEncoder()
            streaming.set(false)
            Log.i(TAG, "H.264 stopped")
        }
    }

    private fun pumpFrames(enc: MediaCodec, out: OutputStream) {
        val info = MediaCodec.BufferInfo()
        val buf = ByteArray(1024 * 256)
        while (streaming.get()) {
            val ix = enc.dequeueOutputBuffer(info, 50_000)
            when {
                ix == MediaCodec.INFO_TRY_AGAIN_LATER -> continue
                ix == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> continue
                ix >= 0 -> {
                    try {
                        val buffer = enc.getOutputBuffer(ix) ?: continue
                        if (info.size > 0) {
                            buffer.position(info.offset)
                            buffer.limit(info.offset + info.size)
                            val n = info.size
                            if (n <= buf.size) {
                                buffer.get(buf, 0, n)
                                out.write(buf, 0, n)
                            } else {
                                val big = ByteArray(n)
                                buffer.get(big)
                                out.write(big)
                            }
                            out.flush()
                        }
                    } catch (e: Exception) {
                        enc.releaseOutputBuffer(ix, false)
                        throw e
                    }
                    enc.releaseOutputBuffer(ix, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
            }
        }
    }

    private fun releaseEncoder() {
        try {
            virtualDisplay?.release()
        } catch (_: Exception) {
        }
        virtualDisplay = null
        try {
            inputSurface?.release()
        } catch (_: Exception) {
        }
        inputSurface = null
        try {
            codec?.stop()
            codec?.release()
        } catch (_: Exception) {
        }
        codec = null
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        serverSocket = null
    }

    private const val TAG = "AsperaMirrorBridge"
}
