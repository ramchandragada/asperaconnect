package com.asperaconnect.companion

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.view.accessibility.AccessibilityEvent
import org.json.JSONObject

class AsperaAccessibilityService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    override fun onServiceConnected() {
        instance = this
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    companion object {
        @Volatile
        private var instance: AsperaAccessibilityService? = null

        fun dispatch(msg: JSONObject) {
            val svc = instance ?: return
            when (msg.optString("kind")) {
                "back" -> svc.performGlobalAction(GLOBAL_ACTION_BACK)
                "home" -> svc.performGlobalAction(GLOBAL_ACTION_HOME)
                "recents" -> svc.performGlobalAction(GLOBAL_ACTION_RECENTS)
                "tap" -> {
                    val x = msg.optDouble("x", 0.0).toFloat()
                    val y = msg.optDouble("y", 0.0).toFloat()
                    svc.tap(x, y)
                }
            }
        }
    }

    private fun tap(x: Float, y: Float) {
        if (Build.VERSION.SDK_INT < 24) return
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 50)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        dispatchGesture(gesture, null, null)
    }
}
