# ADR 0053 — Native notification scheduling

Accepted 2026-10-03.

NotificationIntent, NotificationPlanner and NotificationPort belong to Application.
The pure planner consumes an authorized workspace snapshot, scopes identifiers by
server/workspace/principal and excludes deleted/completed/canceled tasks. It plans
start, due, overdue, occurrence expiry and daily digest for seven calendar days.
Calendar instants use the workspace or recurrence timezone and handle DST. Delivery
is delegated to the operating system, never a WebView timeout. Native contracts
contain scoped IDs, generic localized labels and UTC deadlines; no Markdown,
credentials or user task titles are copied into the OS queue.

Web reports unavailable. Native scheduling is opt-in, with a boolean preference
isolated by identity. Bootstrap is the only infrastructure assembly point. It
serializes reconcile/cancel, rejects stale identity generations, clears schedules
on logout/account/server changes, and avoids planning from an unloaded snapshot.
Failures are visible in Settings. The earliest 256 intents are scheduled; Settings
reports truncation. Completed/deleted entities disappear on snapshot reconciliation.
When the application remains closed, an already scheduled generic reminder can
still fire after a remote mutation; no always-running server agent is implied.

## Windows

The adapter uses Windows.UI.Notifications ScheduledToastNotification and an AUMID
Start Menu shortcut pointing to the installed executable. Permission requests
register the application identity and query ToastNotifier.Setting. Reconcile
compares scheduled IDs/deadlines/content and removes obsolete owned entries.
IDs use a 14-character opaque SHA-256 prefix; collisions in a batch are rejected.
The target machine rejected 16-character IDs with WPN_E_DEV_ID_SIZE, so the adapter
uses a shorter value within the documented limit. COM string ownership is explicit.
The owned shortcut is separate from the main installer shortcut and must be removed
by a future uninstall integration when native packaging is reviewed.

A disposable OS integration test schedules in a child process, exits that process,
reads the real system queue from the parent, then cancels and removes its shortcut.
This proves schedule retention after process exit; it does not claim visual toast
or upgrade/uninstall acceptance. Delivery while a machine is off is subject to the
Windows five-minute scheduling window. No guaranteed recovery after a longer power
off period is promised.

## Android

The Tauri mobile plugin uses WorkManager unique OneTimeWorkRequest jobs and a
NotificationChannel. Minimal desired intents are persisted in private preferences.
Reconcile writes desired state before enqueue; unchanged requests use KEEP, which
also fills the write/enqueue crash gap. Changed requests use REPLACE. Delivery checks
the persisted ID/deadline, permission and a fifteen-minute late grace period.
Retryable worker failures are logged and retried, rather than treated as success.
Clicking a notification opens the application. Android 24/25 use compatibility
notifications; channels are created only on Android 26 and later.

The manifest declares POST_NOTIFICATIONS and RECEIVE_BOOT_COMPLETED. Android 13+
requests notification permission on an explicit Settings action. A non-exported
receiver handles boot, timezone and wall-clock changes; WorkManager also persists
jobs across process death/reboot. Jobs retain absolute instants already derived
from the workspace timezone. WorkManager is subject to Doze/system scheduling:
notifications are reminders, not exact alarms. No USE_EXACT_ALARM permission is
requested. Intent preferences contain no secrets; account changes cancel old work.

Kotlin/Java bytecode targets 11 and Kotlin 2.1.20 match WorkManager 2.12.0. Maven
Central's official Google-hosted mirror is available when the main endpoint is
blocked. Android source/JVM tests and Android Rust target compile are validated;
physical-device process death, permission denial, reboot, timezone-change and
visual-delivery acceptance still require a connected device. Do not describe those
as tested on a device without actual evidence.

## References

- [Windows scheduled notifications](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-scheduled)
- [Desktop AUMID shortcut requirements](https://learn.microsoft.com/en-us/windows/win32/shell/enable-desktop-toast-with-appusermodelid)
- [Scheduled notification ID](https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.scheduledtoastnotification.id)
- [Android notification runtime permission](https://developer.android.com/develop/ui/views/notifications/notification-permission)
- [WorkManager persistent work](https://developer.android.com/develop/background-work/background-tasks/persistent-work)
- [WorkManager releases](https://developer.android.com/jetpack/androidx/releases/work)
