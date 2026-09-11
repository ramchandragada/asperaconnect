package com.asperaconnect.companion

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/** Read phone contacts for Easy-mode sync to the PC. */
object ContactReader {
    fun listContacts(context: Context): Pair<Boolean, JSONArray> {
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.READ_CONTACTS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            return false to JSONArray()
        }

        // contactId -> (name, phones with preference score)
        data class Acc(var name: String, val phones: LinkedHashMap<String, Int>)
        val byId = LinkedHashMap<String, Acc>()

        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.TYPE,
            ContactsContract.CommonDataKinds.Phone.IS_PRIMARY,
        )

        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            projection,
            null,
            null,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} COLLATE LOCALIZED ASC",
        )?.use { cursor ->
            val idIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)
            val nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
            val numIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
            val typeIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.TYPE)
            val primaryIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.IS_PRIMARY)
            if (idIdx < 0 || nameIdx < 0 || numIdx < 0) return true to JSONArray()

            while (cursor.moveToNext()) {
                val id = cursor.getLong(idIdx).toString()
                val name = cursor.getString(nameIdx)?.trim().orEmpty()
                val raw = cursor.getString(numIdx)?.trim().orEmpty()
                if (raw.isEmpty()) continue
                val normalized = normalizePhone(raw)
                if (normalized.length < 3) continue

                val type = if (typeIdx >= 0) cursor.getInt(typeIdx) else 0
                val primary = primaryIdx >= 0 && cursor.getInt(primaryIdx) != 0
                val score = phoneScore(type, primary)

                val acc = byId.getOrPut(id) { Acc(name.ifBlank { normalized }, LinkedHashMap()) }
                if (name.isNotBlank() && (acc.name.isBlank() || acc.name == normalized)) {
                    acc.name = name
                }
                val prev = acc.phones[normalized]
                if (prev == null || score > prev) {
                    acc.phones[normalized] = score
                }
            }
        }

        val out = JSONArray()
        for ((id, acc) in byId) {
            if (acc.phones.isEmpty()) continue
            val phones = acc.phones.entries
                .sortedByDescending { it.value }
                .map { it.key }
            val arr = JSONArray()
            for (p in phones) arr.put(p)
            out.put(
                JSONObject()
                    .put("id", id)
                    .put("name", acc.name.ifBlank { phones.first() })
                    .put("phones", arr),
            )
        }
        return true to out
    }

    private fun phoneScore(type: Int, primary: Boolean): Int {
        var score = when (type) {
            ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE -> 40
            ContactsContract.CommonDataKinds.Phone.TYPE_MAIN -> 30
            ContactsContract.CommonDataKinds.Phone.TYPE_WORK_MOBILE -> 35
            ContactsContract.CommonDataKinds.Phone.TYPE_WORK -> 20
            ContactsContract.CommonDataKinds.Phone.TYPE_HOME -> 15
            else -> 10
        }
        if (primary) score += 50
        return score
    }

    private fun normalizePhone(raw: String): String {
        val sb = StringBuilder()
        for (c in raw) {
            when {
                c.isDigit() -> sb.append(c)
                c == '+' && sb.isEmpty() -> sb.append(c)
            }
        }
        return sb.toString()
    }
}
