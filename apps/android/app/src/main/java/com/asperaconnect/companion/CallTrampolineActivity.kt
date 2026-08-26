package com.asperaconnect.companion

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/**
 * Tiny trampoline so a notification / full-screen intent can start a call
 * even when Aspera is in the background (Android blocks startActivity from services).
 */
class CallTrampolineActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val number = intent?.getStringExtra(EXTRA_NUMBER).orEmpty()
        val direct = intent?.getBooleanExtra(EXTRA_DIRECT, true) != false
        if (number.length >= 3) {
            val action = if (direct) Intent.ACTION_CALL else Intent.ACTION_DIAL
            try {
                startActivity(
                    Intent(action, Uri.parse("tel:$number")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (_: SecurityException) {
                startActivity(
                    Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (_: Exception) {
            }
        }
        finish()
    }

    companion object {
        const val EXTRA_NUMBER = "number"
        const val EXTRA_DIRECT = "direct"
    }
}
