# ADR 0118 — One durable record delivery path

Status: implementation in progress, 2026-10-16. FINAL Notification blocker remains open.

Reminder describes intent; NotificationRecord describes attention; Delivery tracks
the device side effect. Application derives future causes from local durable
entities, applies quiet hours, privacy and source preferences, and reconciles a
bounded desired set with the native scheduler. Rust/Kotlin do not duplicate Work
business rules. No independent legacy planner runs alongside this pipeline.

Immediate delivery claims a record with CAS before presenting it. A durable
60-second lease prevents two windows from presenting concurrently and permits
restart recovery. This is not a claim of exactly-once delivery across an OS crash.
Stable native tags replace the same record rather than stacking it. Future plans
are marked SCHEDULED only after native acknowledgement. Completion/deletion,
dismissal, schedule changes and permission changes remove unwanted future plans.

Windows persists scheduled toasts in the OS. A per-user COM activation class and
quoted LocalServer32 executable command route both running and cold activation
into the same native take-once queue. The frontend event is only a signal; it
cannot supply its own trusted route. Absolute/control-character routes are denied.
Registration changes only this application's per-user identity, never OS permission
settings. Unpackaged applications need a silent, expiring, popup-suppressed first
toast before querying Setting; its private registration tag is removed immediately.
This avoids the reproduced HRESULT 80070490 without ignoring permission checks.

Android persists the desired payload and uses AlarmManager exact alarms, with
explicit exact-alarm permission on supported versions. Boot/time changes restore
alarms. Existing WorkManager jobs are cancelled; they do not form a second
scheduler. Launch routes are validated and consumed once.

Evidence so far: focused notification32/32; real IndexedDB claim/restart5/5;
Kotlin compile and JVM6/6; browser6/6 across three projects; Windows native
presentation probe PASS (Action Center history1); Windows OS schedule survives
process exit PASS. Initial probe/compile failures remain in artifacts. Final
production rebuild, cold-click acceptance, remaining attention policies and
complete second FINAL matrix are outstanding; do not mark this ADR fully verified.

Platform references (API behavior only; no implementation copied):
[Microsoft desktop COM activation](https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/send-local-toast-desktop-cpp-wrl),
[Toolkit Setting registration requirement](https://github.com/CommunityToolkit/WindowsCommunityToolkit/blob/main/Microsoft.Toolkit.Uwp.Notifications/Toasts/Compat/ToastNotifierCompat.cs).
