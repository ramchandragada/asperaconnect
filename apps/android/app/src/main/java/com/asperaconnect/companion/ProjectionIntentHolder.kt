package com.asperaconnect.companion

import android.content.Intent

/**
 * Hold MediaProjection permission result in-process.
 * Passing the result [Intent] through a Service start Intent is unreliable on some OEMs
 * (binder extras get dropped → getMediaProjection fails → need_screen_capture forever).
 */
object ProjectionIntentHolder {
    @Volatile
    var resultCode: Int = 0

    @Volatile
    var data: Intent? = null

    fun set(resultCode: Int, data: Intent) {
        this.resultCode = resultCode
        this.data = data
    }

    fun clear() {
        resultCode = 0
        data = null
    }

    fun take(): Pair<Int, Intent>? {
        val d = data ?: return null
        val code = resultCode
        return code to d
    }
}
