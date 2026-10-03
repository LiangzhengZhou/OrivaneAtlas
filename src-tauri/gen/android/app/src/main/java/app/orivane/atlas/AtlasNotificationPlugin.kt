package app.orivane.atlas

import android.Manifest
import android.app.PendingIntent
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
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
class NotificationIntentArgs { var id = ""; var scope = ""; var title = ""; var deliverAtMs = 0L }
@InvokeArg
class NotificationReconcileArgs { var intents: List<NotificationIntentArgs> = emptyList() }
@InvokeArg
class NotificationCancelArgs { var ids: List<String> = emptyList() }

object NotificationScheduler {
    val executor = Executors.newSingleThreadExecutor()
    const val CHANNEL = "atlas-tasks-v1"
    private fun preferences(context: Context) = context.getSharedPreferences("atlas-notifications-v1", Context.MODE_PRIVATE)
    private fun read(context: Context): List<AtlasNotificationIntent> {
        val json = JSONArray(preferences(context).getString("intents", "[]"))
        return (0 until json.length()).map { val item = json.getJSONObject(it); AtlasNotificationIntent(item.getString("id"), item.getString("scope"), item.getString("title"), item.getLong("deliverAtMs")) }
    }
    private fun write(context: Context, intents: List<AtlasNotificationIntent>) {
        val json = JSONArray()
        for (intent in intents) json.put(JSONObject().put("id", intent.id).put("scope", intent.scope).put("title", intent.title).put("deliverAtMs", intent.deliverAtMs))
        check(preferences(context).edit().putString("intents", json.toString()).commit())
    }
    fun allowed(context: Context): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()
    fun channel(context: Context) {
        if (Build.VERSION.SDK_INT >= 26) context.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "Orivane Atlas tasks", NotificationManager.IMPORTANCE_DEFAULT))
    }
    @Synchronized
    fun reconcile(context: Context, intents: List<AtlasNotificationIntent>, force: Boolean = false) {
        NotificationPolicy.validate(intents)
        val now = System.currentTimeMillis()
        val desired = intents.filter { !NotificationPolicy.expired(it, now) }
        val old = read(context).associateBy { it.id }
        write(context, desired)
        val manager = WorkManager.getInstance(context)
        for (previous in old.values) if (desired.none { it.id == previous.id }) manager.cancelUniqueWork(NotificationPolicy.key(previous.id)).result.get()
        channel(context)
        for (intent in desired) {
            val data = Data.Builder().putString("id", intent.id).putLong("deadline", intent.deliverAtMs).build()
            val request = OneTimeWorkRequestBuilder<AtlasNotificationWorker>().setInputData(data).setInitialDelay(NotificationPolicy.delay(intent, now), TimeUnit.MILLISECONDS).build()
            manager.enqueueUniqueWork(NotificationPolicy.key(intent.id), if (!force && old[intent.id] == intent) ExistingWorkPolicy.KEEP else ExistingWorkPolicy.REPLACE, request).result.get()
        }
    }
    @Synchronized
    fun cancel(context: Context, ids: List<String>) {
        require(ids.size <= NotificationPolicy.MAX_INTENTS && ids.all { it.length <= 2048 })
        reconcile(context, read(context).filter { !ids.contains(it.id) })
        for (id in ids) NotificationManagerCompat.from(context).cancel(NotificationPolicy.key(id), 0)
    }
    @Synchronized
    fun reschedule(context: Context) = reconcile(context, read(context), true)
    @Synchronized
    fun deliver(context: Context, id: String, deadline: Long): Boolean {
        val intent = read(context).find { it.id == id && it.deliverAtMs == deadline } ?: return true
        if (NotificationPolicy.expired(intent, System.currentTimeMillis())) { write(context, read(context).filter { it.id != id }); return true }
        if (!allowed(context)) return true
        channel(context)
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val pending = launch?.let { PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
        val notice = NotificationCompat.Builder(context, CHANNEL).setContentIntent(pending).setSmallIcon(R.drawable.ic_launcher_foreground).setContentTitle("Orivane Atlas").setContentText(intent.title).setAutoCancel(true).build()
        NotificationManagerCompat.from(context).notify(NotificationPolicy.key(id), 0, notice)
        write(context, read(context).filter { it.id != id })
        return true
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
        if (intent.action !in listOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_TIMEZONE_CHANGED, Intent.ACTION_TIME_CHANGED)) return
        val result = goAsync()
        NotificationScheduler.executor.execute { try { NotificationScheduler.reschedule(context.applicationContext) } catch (error: Exception) { android.util.Log.e("AtlasNotifications", "Rescheduling failed", error) } finally { result.finish() } }
    }
}

@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")])
class AtlasNotificationPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun notificationPermission(invoke: Invoke) {
        val permission = if (NotificationScheduler.allowed(activity)) "granted" else if (Build.VERSION.SDK_INT >= 33 && !activity.getPreferences(Context.MODE_PRIVATE).getBoolean("notificationsAsked", false)) "prompt" else "denied"
        invoke.resolve(JSObject().put("permission", permission))
    }
    @Command
    fun requestNotificationPermission(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= 33) { activity.getPreferences(Context.MODE_PRIVATE).edit().putBoolean("notificationsAsked", true).apply(); requestPermissionForAlias("notifications", invoke, "notificationPermissionResult") } else notificationPermission(invoke)
    }
    @PermissionCallback
    fun notificationPermissionResult(invoke: Invoke) = notificationPermission(invoke)
    @Command
    fun reconcile(invoke: Invoke) {
        val args = invoke.parseArgs(NotificationReconcileArgs::class.java)
        NotificationScheduler.executor.execute { try { NotificationScheduler.reconcile(activity.applicationContext, args.intents.map { AtlasNotificationIntent(it.id, it.scope, it.title, it.deliverAtMs) }); invoke.resolve() } catch (_: Exception) { invoke.reject("notification_reconcile") } }
    }
    @Command
    fun cancel(invoke: Invoke) {
        val args = invoke.parseArgs(NotificationCancelArgs::class.java)
        NotificationScheduler.executor.execute { try { NotificationScheduler.cancel(activity.applicationContext, args.ids); invoke.resolve() } catch (_: Exception) { invoke.reject("notification_cancel") } }
    }
}
