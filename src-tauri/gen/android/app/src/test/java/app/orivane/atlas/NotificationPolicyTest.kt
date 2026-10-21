package app.orivane.atlas

import org.junit.Assert.*
import org.junit.Test

class NotificationPolicyTest {
    @Test fun notificationRoutesRejectExternalAndControlCharacterPayloads() {
        assertTrue(NotificationPolicy.validRoute("/calendar"))
        assertTrue(NotificationPolicy.validRoute("/files/stable-id"))
        for (route in listOf("https://example.com", "//example.com", "/\\external", "/tasks/\ninvalid", "/" + "x".repeat(512))) {
            assertFalse(route, NotificationPolicy.validRoute(route))
        }
    }
    @Test fun accountAndWorkspaceKeysAreIsolated() {
        assertNotEquals(NotificationPolicy.key("server-a/workspace-a/principal-a/task"), NotificationPolicy.key("server-b/workspace-a/principal-a/task"))
        assertNotEquals(NotificationPolicy.key("server-a/workspace-a/principal-a/task"), NotificationPolicy.key("server-a/workspace-b/principal-a/task"))
        assertNotEquals(NotificationPolicy.key("server-a/workspace-a/principal-a/task"), NotificationPolicy.key("server-a/workspace-a/principal-b/task"))
        assertEquals(14, NotificationPolicy.key("task").length)
    }
    @Test fun rescheduleRetainsDeadlineAndRejectsStaleDelivery() {
        val intent = AtlasNotificationIntent("id", "scope", "Task due", 1000000)
        assertEquals(100000L, NotificationPolicy.delay(intent, 900000))
        assertEquals(0L, NotificationPolicy.delay(intent, 1000010))
        assertFalse(NotificationPolicy.expired(intent, 1000010))
        assertTrue(NotificationPolicy.expired(intent, 1000000 + NotificationPolicy.LATE_GRACE_MS + 1))
    }
    @Test fun duplicateAndMixedIdentityPlansAreRejected() {
        val intent = AtlasNotificationIntent("id", "scope", "Task due", 1000000)
        for (invalid in listOf(listOf(intent, intent), listOf(intent, intent.copy(id="other",scope="other")), listOf(intent.copy(deliverAtMs=-1)))) {
            try { NotificationPolicy.validate(invalid); fail("Invalid schedule accepted") } catch (_: IllegalArgumentException) { }
        }
    }
}
