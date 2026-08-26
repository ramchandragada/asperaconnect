package com.asperaconnect.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Holds MediaProjection and runs Easy-mode H.264 stream (TCP [MirrorBridge.VIDEO_PORT]).
 */
class MirrorService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                MirrorBridge.stopStreaming()
                MirrorBridge.setProjection(null)
                ProjectionIntentHolder.clear()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START_STREAM -> {
                ensureProjectionFromHolder()
                startAsForeground(
                    if (MirrorBridge.hasProjection()) {
                        "Easy mirror streaming…"
                    } else {
                        "Screen capture missing — open app → step 3"
                    },
                )
                val dm = resources.displayMetrics
                val ok = MirrorBridge.startStreaming(dm.densityDpi, dm.widthPixels, dm.heightPixels)
                Log.i(TAG, "START_STREAM ok=$ok hasProjection=${MirrorBridge.hasProjection()}")
                return START_STICKY
            }
            ACTION_STOP_STREAM -> {
                MirrorBridge.stopStreaming()
                startAsForeground(
                    if (MirrorBridge.hasProjection()) {
                        "Screen capture ready — start Easy mirror on PC"
                    } else {
                        "Screen capture off"
                    },
                )
                return START_STICKY
            }
            ACTION_BIND_PROJECTION -> {
                startAsForeground("Starting screen capture…")
                val ok = ensureProjectionFromHolder()
                if (ok) {
                    val dm = resources.displayMetrics
                    MirrorBridge.startStreaming(dm.densityDpi, dm.widthPixels, dm.heightPixels)
                    startAsForeground("Screen capture ON — start Easy mirror on PC")
                    sendBroadcast(
                        Intent(ACTION_CAPTURE_STATE).apply {
                            setPackage(packageName)
                            putExtra(EXTRA_CAPTURE_READY, true)
                        },
                    )
                } else {
                    startAsForeground("Screen capture failed — tap step 3 again")
                    sendBroadcast(
                        Intent(ACTION_CAPTURE_STATE).apply {
                            setPackage(packageName)
                            putExtra(EXTRA_CAPTURE_READY, false)
                        },
                    )
                    Log.e(TAG, "bind projection failed (null MediaProjection)")
                }
                return START_STICKY
            }
        }

        // Legacy path: extras on the service intent (kept as fallback).
        startAsForeground("Starting screen capture…")
        val fromExtras = bindProjectionFromIntentExtras(intent)
        val fromHolder = if (!fromExtras) ensureProjectionFromHolder() else true
        if (fromExtras || fromHolder) {
            val dm = resources.displayMetrics
            MirrorBridge.startStreaming(dm.densityDpi, dm.widthPixels, dm.heightPixels)
            startAsForeground("Screen capture ON — start Easy mirror on PC")
            sendBroadcast(
                Intent(ACTION_CAPTURE_STATE).apply {
                    setPackage(packageName)
                    putExtra(EXTRA_CAPTURE_READY, true)
                },
            )
        } else {
            startAsForeground("Screen capture failed — open app → step 3")
            sendBroadcast(
                Intent(ACTION_CAPTURE_STATE).apply {
                    setPackage(packageName)
                    putExtra(EXTRA_CAPTURE_READY, false)
                },
            )
        }
        return START_STICKY
    }

    private fun ensureProjectionFromHolder(): Boolean {
        if (MirrorBridge.hasProjection()) return true
        val pair = ProjectionIntentHolder.take() ?: return false
        return bindProjection(pair.first, pair.second)
    }

    private fun bindProjectionFromIntentExtras(intent: Intent?): Boolean {
        if (intent == null) return false
        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        val data = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_RESULT_DATA)
        } ?: return false
        return bindProjection(resultCode, data)
    }

    private fun bindProjection(resultCode: Int, data: Intent): Boolean {
        return try {
            val mpm = getSystemService(MediaProjectionManager::class.java)
            val projection = mpm.getMediaProjection(resultCode, data)
            if (projection == null) {
                Log.e(TAG, "getMediaProjection returned null (code=$resultCode)")
                return false
            }
            MirrorBridge.setProjection(projection)
            projection.registerCallback(
                object : android.media.projection.MediaProjection.Callback() {
                    override fun onStop() {
                        Log.w(TAG, "MediaProjection stopped by system/user")
                        MirrorBridge.stopStreaming()
                        MirrorBridge.setProjection(null)
                        ProjectionIntentHolder.clear()
                        startAsForeground("Screen capture ended — tap step 3 again")
                        sendBroadcast(
                            Intent(ACTION_CAPTURE_STATE).apply {
                                setPackage(packageName)
                                putExtra(EXTRA_CAPTURE_READY, false)
                            },
                        )
                    }
                },
                android.os.Handler(android.os.Looper.getMainLooper()),
            )
            Log.i(TAG, "MediaProjection bound — video ${MirrorBridge.VIDEO_PORT}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "bindProjection: ${e.message}", e)
            false
        }
    }

    private fun startAsForeground(text: String) {
        val channelId = "aspera_mirror"
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel(channelId, "Aspera mirroring", NotificationManager.IMPORTANCE_LOW),
            )
        }
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification: Notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Aspera Connect")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentIntent(open)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onDestroy() {
        MirrorBridge.stopStreaming()
        // Keep holder so a quick restart can re-bind if the token is still valid.
        MirrorBridge.setProjection(null)
        super.onDestroy()
    }

    companion object {
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val EXTRA_PIN = "pin"
        const val ACTION_STOP = "com.asperaconnect.companion.MIRROR_STOP"
        const val ACTION_START_STREAM = "com.asperaconnect.companion.MIRROR_START_STREAM"
        const val ACTION_STOP_STREAM = "com.asperaconnect.companion.MIRROR_STOP_STREAM"
        const val ACTION_BIND_PROJECTION = "com.asperaconnect.companion.MIRROR_BIND"
        const val ACTION_CAPTURE_STATE = "com.asperaconnect.companion.CAPTURE_STATE"
        const val ACTION_REQUEST_CAPTURE = "com.asperaconnect.companion.REQUEST_CAPTURE"
        const val EXTRA_CAPTURE_READY = "captureReady"
        private const val NOTIFICATION_ID = 42
        private const val TAG = "AsperaMirror"

        fun startWithProjection(context: Context, resultCode: Int, data: Intent, pin: String?) {
            ProjectionIntentHolder.set(resultCode, data)
            val intent = Intent(context, MirrorService::class.java).apply {
                action = ACTION_BIND_PROJECTION
                putExtra(EXTRA_PIN, pin)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun requestStartStream(context: Context) {
            val intent = Intent(context, MirrorService::class.java).apply {
                action = ACTION_START_STREAM
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun requestStopStream(context: Context) {
            val intent = Intent(context, MirrorService::class.java).apply {
                action = ACTION_STOP_STREAM
            }
            context.startService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, MirrorService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
            context.stopService(Intent(context, MirrorService::class.java))
        }

        fun notifyNeedCapture(context: Context) {
            val channelId = "aspera_mirror_alert"
            val nm = context.getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26) {
                nm.createNotificationChannel(
                    NotificationChannel(
                        channelId,
                        "Aspera mirror prompts",
                        NotificationManager.IMPORTANCE_HIGH,
                    ),
                )
            }
            val open = PendingIntent.getActivity(
                context,
                1,
                Intent(context, MainActivity::class.java).apply {
                    action = ACTION_REQUEST_CAPTURE
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val notification = NotificationCompat.Builder(context, channelId)
                .setContentTitle("Allow screen capture")
                .setContentText("Tap here, then tap Start Easy mirror on the PC again.")
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setContentIntent(open)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()
            nm.notify(43, notification)
            context.sendBroadcast(
                Intent(ACTION_REQUEST_CAPTURE).apply { setPackage(context.packageName) },
            )
        }
    }
}
