package com.asperaconnect.companion

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONObject

class NotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        val extras = sbn.notification.extras
        val title = extras?.getCharSequence("android.title")?.toString().orEmpty()
        val text = extras?.getCharSequence("android.text")?.toString().orEmpty()
        val payload = JSONObject()
            .put("type", "notification")
            .put("id", sbn.key)
            .put("app", sbn.packageName)
            .put("title", title)
            .put("body", text)
        val line = payload.toString()
        Log.i("AsperaNotify", line)
        lastPayload = line
        MirrorService.broadcast(line)
    }

    companion object {
        @Volatile
        var lastPayload: String? = null
    }
}
