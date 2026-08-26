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
 * Holds MediaProjection and can start Easy-mode H.264 stream (TCP [MirrorBridge.VIDEO_PORT]).
 */
class MirrorService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                MirrorBridge.stopStreaming()
                MirrorBridge.setProjection(null)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START_STREAM -> {
                startAsForeground("Easy mirror streaming…")
                val dm = resources.displayMetrics
                val ok = MirrorBridge.startStreaming(dm.densityDpi, dm.widthPixels, dm.heightPixels)
                if (!ok) {
                    Log.w(TAG, "start stream without projection")
                }
                return START_STICKY
            }
            ACTION_STOP_STREAM -> {
                MirrorBridge.stopStreaming()
                startAsForeground("Screen capture ready — waiting for PC")
                return START_STICKY
            }
        }

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        val data = if (Build.VERSION.SDK_INT >= 33) {
            intent?.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent?.getParcelableExtra(EXTRA_RESULT_DATA)
        }

        startAsForeground("Screen capture ready — start Easy mirror on PC")
        if (data != null) {
            val mpm = getSystemService(MediaProjectionManager::class.java)
            val projection = mpm.getMediaProjection(resultCode, data)
            MirrorBridge.setProjection(projection)
            projection?.registerCallback(
                object : android.media.projection.MediaProjection.Callback() {
                    override fun onStop() {
                        MirrorBridge.stopStreaming()
                        MirrorBridge.setProjection(null)
                        stopSelf()
                    }
                },
                android.os.Handler(android.os.Looper.getMainLooper()),
            )
            Log.i(TAG, "MediaProjection ready — video port ${MirrorBridge.VIDEO_PORT}")
            // Warm the encoder server so PC can connect after startMirror.
            val dm = resources.displayMetrics
            MirrorBridge.startStreaming(dm.densityDpi, dm.widthPixels, dm.heightPixels)
        }
        return START_STICKY
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
        private const val NOTIFICATION_ID = 42
        private const val TAG = "AsperaMirror"

        fun startWithProjection(context: Context, resultCode: Int, data: Intent, pin: String?) {
            val intent = Intent(context, MirrorService::class.java).apply {
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_RESULT_DATA, data)
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
    }
}
