package app.orivane.atlas

import java.security.MessageDigest

data class AtlasNotificationIntent(val id: String, val scope: String, val title: String, val deliverAtMs: Long)

object NotificationPolicy {
    const val MAX_INTENTS = 256
    const val LATE_GRACE_MS = 15 * 60 * 1000L
    fun key(id: String): String = "oa" + MessageDigest.getInstance("SHA-256").digest(id.toByteArray(Charsets.UTF_8)).take(6).joinToString("") { "%02x".format(it.toInt() and 255) }
    fun validate(intents: List<AtlasNotificationIntent>) {
        require(intents.size <= MAX_INTENTS)
        require(intents.map { it.id }.distinct().size == intents.size)
        require(intents.map { key(it.id) }.distinct().size == intents.size)
        require(intents.map { it.scope }.distinct().size <= 1)
        for (intent in intents) require(intent.id.isNotEmpty() && intent.id.length <= 2048 && intent.scope.length <= 1024 && intent.title.isNotEmpty() && intent.title.length <= 120 && intent.deliverAtMs in 0..253402300799999L)
    }
    fun delay(intent: AtlasNotificationIntent, now: Long): Long = (intent.deliverAtMs - now).coerceAtLeast(0)
    fun expired(intent: AtlasNotificationIntent, now: Long): Boolean = now > intent.deliverAtMs + LATE_GRACE_MS
}
