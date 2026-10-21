package app.orivane.atlas

import android.Manifest
import android.app.PendingIntent
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.AlarmManager
import android.net.Uri
import android.provider.Settings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@InvokeArg
class NotificationIntentArgs { var id = ""; var scope = ""; var title = ""; var deliverAtMs = 0L; var body = ""; var route = ""; var urgency = "NORMAL" }
@InvokeArg
class NotificationReconcileArgs { var intents: List<NotificationIntentArgs> = emptyList() }
@InvokeArg
class NotificationCancelArgs { var ids: List<String> = emptyList() }
@InvokeArg
class NotificationPresentPayload { var id = ""; var title = ""; var body = ""; var route = ""; var urgency = "NORMAL" }
@InvokeArg
class NotificationPresentArgs { var payload = NotificationPresentPayload() }

object NotificationScheduler {
    val executor = Executors.newSingleThreadExecutor()
    const val CHANNEL = "atlas-tasks-v1"
    private fun preferences(context: Context) = context.getSharedPreferences("atlas-notifications-v1", Context.MODE_PRIVATE)
    private fun read(context: Context): List<AtlasNotificationIntent> {
        val json = JSONArray(preferences(context).getString("intents", "[]"))
        return (0 until json.length()).map { val item = json.getJSONObject(it); AtlasNotificationIntent(item.getString("id"), item.getString("scope"), item.getString("title"), item.getLong("deliverAtMs"), item.optString("body"), item.optString("route"), item.optString("urgency", "NORMAL")) }
    }
    private fun write(context: Context, intents: List<AtlasNotificationIntent>) {
        val json = JSONArray()
        for (intent in intents) json.put(JSONObject().put("id", intent.id).put("scope", intent.scope).put("title", intent.title).put("deliverAtMs", intent.deliverAtMs).put("body", intent.body).put("route", intent.route).put("urgency", intent.urgency))
        check(preferences(context).edit().putString("intents", json.toString()).commit())
    }
    fun allowed(context: Context): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()
    fun exactAllowed(context: Context): Boolean = Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    private fun alarm(context: Context, id: String, deadline: Long): PendingIntent = PendingIntent.getBroadcast(context, 0,
        Intent(context, AtlasNotificationAlarmReceiver::class.java).setAction(NotificationPolicy.key(id)).putExtra("id", id).putExtra("deadline", deadline), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun channel(context: Context) {
        if (Build.VERSION.SDK_INT >= 26) context.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "Orivane Atlas tasks", NotificationManager.IMPORTANCE_DEFAULT))
    }
    @Synchronized
    fun reconcile(context: Context, intents: List<AtlasNotificationIntent>, force: Boolean = false) {
        NotificationPolicy.validate(intents)
        val now = System.currentTimeMillis()
        val desired = intents.filter { !NotificationPolicy.expired(it, now) }
        val old = read(context).associateBy { it.id }
        require(desired.isEmpty() || exactAllowed(context)) { "notification_exact_alarm_permission" }
        write(context, desired)
        val manager = WorkManager.getInstance(context)
        val alarms = context.getSystemService(AlarmManager::class.java)
        // Retire old WorkManager schedules; one AlarmManager path owns delivery.
        for (previous in old.values) {
            manager.cancelUniqueWork(NotificationPolicy.key(previous.id)).result.get()
            if (desired.none { it.id == previous.id }) alarms.cancel(alarm(context, previous.id, previous.deliverAtMs))
        }
        channel(context)
        for (intent in desired) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, intent.deliverAtMs, alarm(context, intent.id, intent.deliverAtMs))
        }
    }
    @Synchronized
    fun cancel(context: Context, ids: List<String>) {
        require(ids.size <= NotificationPolicy.MAX_INTENTS && ids.all { it.length <= 2048 })
        reconcile(context, read(context).filter { !ids.contains(it.id) })
        for (id in ids) NotificationManagerCompat.from(context).cancel(NotificationPolicy.key(id), 0)
    }
    /** Immediate delivery of an already-persisted NotificationRecord. Same id replaces, never stacks. */
    fun present(context: Context, payload: NotificationPresentPayload) {
        require(payload.id.isNotEmpty() && payload.id.length <= 2048 && payload.title.isNotEmpty() && payload.title.length <= 120 && payload.body.length <= 400)
        require(NotificationPolicy.validRoute(payload.route))
        if (!allowed(context)) throw IllegalStateException("notification_permission")
        channel(context)
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply { putExtra("orivane_route", payload.route) }
        val pending = launch?.let { PendingIntent.getActivity(context, NotificationPolicy.key(payload.id).hashCode(), it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
        val priority = if (payload.urgency == "HIGH") NotificationCompat.PRIORITY_HIGH else if (payload.urgency == "LOW") NotificationCompat.PRIORITY_LOW else NotificationCompat.PRIORITY_DEFAULT
        val builder = NotificationCompat.Builder(context, CHANNEL).setContentIntent(pending).setSmallIcon(R.drawable.atlas_notification).setContentTitle(payload.title).setPriority(priority).setAutoCancel(true)
        if (payload.body.isNotEmpty()) builder.setContentText(payload.body)
        NotificationManagerCompat.from(context).notify(NotificationPolicy.key(payload.id), 1, builder.build())
    }
    @Synchronized
    fun reschedule(context: Context) = reconcile(context, read(context), true)
    @Synchronized
    fun deliver(context: Context, id: String, deadline: Long): Boolean {
        val intent = read(context).find { it.id == id && it.deliverAtMs == deadline } ?: return true
        if (NotificationPolicy.expired(intent, System.currentTimeMillis())) { write(context, read(context).filter { it.id != id }); return true }
        if (!allowed(context)) return true
        if (intent.route.isNotEmpty()) {
            present(context, NotificationPresentPayload().apply { this.id = intent.id; title = intent.title; body = intent.body; route = intent.route; urgency = intent.urgency })
            write(context, read(context).filter { it.id != id })
            return true
        }
        channel(context)
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val pending = launch?.let { PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
        val notice = NotificationCompat.Builder(context, CHANNEL).setContentIntent(pending).setSmallIcon(R.drawable.atlas_notification).setContentTitle("Orivane Atlas").setContentText(intent.title).setAutoCancel(true).build()
        NotificationManagerCompat.from(context).notify(NotificationPolicy.key(id), 0, notice)
        write(context, read(context).filter { it.id != id })
        return true
    }
}

class AtlasNotificationAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        val deadline = intent.getLongExtra("deadline", -1)
        val pending = goAsync()
        NotificationScheduler.executor.execute { try { NotificationScheduler.deliver(context.applicationContext, id, deadline) } catch (error: Exception) { android.util.Log.e("AtlasNotifications", "Alarm delivery failed", error) } finally { pending.finish() } }
    }
}

class AtlasNotificationWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result { return try {
        NotificationScheduler.deliver(applicationContext, inputData.getString("id") ?: return Result.failure(), inputData.getLong("deadline", -1))
        Result.success()
    } catch (error: Exception) { android.util.Log.e("AtlasNotifications", "Worker scheduling failed", error); Result.retry() } }
}

class AtlasNotificationRescheduleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in listOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_TIMEZONE_CHANGED, Intent.ACTION_TIME_CHANGED, AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED)) return
        val result = goAsync()
        NotificationScheduler.executor.execute { try { NotificationScheduler.reschedule(context.applicationContext) } catch (error: Exception) { android.util.Log.e("AtlasNotifications", "Rescheduling failed", error) } finally { result.finish() } }
    }
}

@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")])
class AtlasNotificationPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun notificationPermission(invoke: Invoke) {
        val permission = if (NotificationScheduler.allowed(activity) && NotificationScheduler.exactAllowed(activity)) "granted" else if (NotificationScheduler.allowed(activity) || (Build.VERSION.SDK_INT >= 33 && !activity.getPreferences(Context.MODE_PRIVATE).getBoolean("notificationsAsked", false))) "prompt" else "denied"
        invoke.resolve(JSObject().put("permission", permission))
    }
    @Command
    fun requestNotificationPermission(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= 33 && !NotificationScheduler.allowed(activity)) { activity.getPreferences(Context.MODE_PRIVATE).edit().putBoolean("notificationsAsked", true).apply(); requestPermissionForAlias("notifications", invoke, "notificationPermissionResult") } else notificationPermissionResult(invoke)
    }
    @PermissionCallback
    fun notificationPermissionResult(invoke: Invoke) {
        if (NotificationScheduler.allowed(activity) && !NotificationScheduler.exactAllowed(activity) && Build.VERSION.SDK_INT >= 31)
            activity.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + activity.packageName)))
        notificationPermission(invoke)
    }
    @Command
    fun reconcile(invoke: Invoke) {
        val args = invoke.parseArgs(NotificationReconcileArgs::class.java)
        NotificationScheduler.executor.execute { try { NotificationScheduler.reconcile(activity.applicationContext, args.intents.map { AtlasNotificationIntent(it.id, it.scope, it.title, it.deliverAtMs, it.body, it.route, it.urgency.ifEmpty { "NORMAL" }) }); invoke.resolve() } catch (_: Exception) { invoke.reject("notification_reconcile") } }
    }
    /** A tap while the app is alive arrives as a new intent; keep it so takeRoute can see it. */
    override fun onNewIntent(intent: Intent) {
        activity.intent = intent
    }
    /** Returns the notification route carried by the launch intent once, then clears it. */
    @Command
    fun takeRoute(invoke: Invoke) {
        val route = activity.intent?.getStringExtra("orivane_route")
        activity.intent?.removeExtra("orivane_route")
        val valid = route != null && NotificationPolicy.validRoute(route)
        invoke.resolve(JSObject().put("route", if (valid) route else null))
    }
    @Command
    fun present(invoke: Invoke) {
        val args = invoke.parseArgs(NotificationPresentArgs::class.java)
        NotificationScheduler.executor.execute { try { NotificationScheduler.present(activity.applicationContext, args.payload); invoke.resolve() } catch (_: Exception) { invoke.reject("notification_present") } }
    }
    @Command
    fun cancel(invoke: Invoke) {
        val args = invoke.parseArgs(NotificationCancelArgs::class.java)
        NotificationScheduler.executor.execute { try { NotificationScheduler.cancel(activity.applicationContext, args.ids); invoke.resolve() } catch (_: Exception) { invoke.reject("notification_cancel") } }
    }
}
