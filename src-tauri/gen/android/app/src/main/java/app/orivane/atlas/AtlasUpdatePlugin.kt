package app.orivane.atlas

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/** Only local Tauri commands can reach this plugin; no WebView JavaScript interface. */
@TauriPlugin
class AtlasUpdatePlugin(private val activity: Activity) : Plugin(activity) {
    private val worker = Executors.newSingleThreadExecutor()
    private val feed = "https://github.com/LiangzhengZhou/OrivaneAtlas/releases/latest/download/android.json"
    private val maxApk = 300L * 1024 * 1024

    private fun connection(source: String): HttpsURLConnection {
        var url = URL(source)
        repeat(6) {
            require(url.protocol == "https" && url.userInfo == null && url.port in listOf(-1, 443))
            require(url.host in listOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"))
            val conn = url.openConnection() as HttpsURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 30000
            conn.readTimeout = 60000
            conn.setRequestProperty("User-Agent", "OrivaneAtlas-Updater")
            if (conn.responseCode in listOf(301, 302, 303, 307, 308)) {
                val next = conn.getHeaderField("Location") ?: error("redirect")
                conn.disconnect()
                url = URL(url, next)
            } else {
                require(conn.responseCode == 200)
                return conn
            }
        }
        error("redirect_limit")
    }

    private fun manifest(): JSONObject {
        val conn = connection(feed)
        try {
            val bytes = conn.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(4096)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    require(output.size() + count <= 65536)
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            require(bytes.size <= 65536)
            val value = JSONObject(String(bytes, Charsets.UTF_8))
            require(value.getString("channel") == "stable")
            require(value.getString("packageId") == activity.packageName)
            require(value.getString("abi") == "arm64-v8a" && Build.SUPPORTED_ABIS.contains("arm64-v8a"))
            UpdatePolicy.assetUrl(value.getString("url"))
            require(value.getString("sha256").matches(Regex("[a-f0-9]{64}")))
            require(value.getLong("size") in 1..maxApk)
            require(value.getInt("versionCode") > 0)
            require(value.getInt("minSdk") <= Build.VERSION.SDK_INT)
            return value
        } finally { conn.disconnect() }
    }

    @Suppress("DEPRECATION")
    private fun installed() = activity.packageManager.getPackageInfo(activity.packageName, PackageManager.GET_SIGNATURES)
    @Suppress("DEPRECATION")
    private fun code(info: android.content.pm.PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    @Command
    fun check(invoke: Invoke) {
        worker.execute {
            try {
                val current = installed()
                val value = manifest()
                val result = JSObject()
                result.put("currentVersion", current.versionName)
                result.put("version", if (value.getLong("versionCode") > code(current)) value.getString("version") else JSONObject.NULL)
                result.put("notes", value.optString("notes"))
                result.put("channel", "stable")
                invoke.resolve(result)
            } catch (_: Exception) { invoke.reject("update_network_or_metadata") }
        }
    }

    @Command
    @Suppress("DEPRECATION")
    fun install(invoke: Invoke) {
        val requested = invoke.getArgs().optString("version")
        if (requested.isEmpty()) return invoke.reject("update_version_required")
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            activity.runOnUiThread {
                try {
                    activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName)))
                    invoke.reject("update_permission_retry")
                } catch (_: Exception) { invoke.reject("update_permission_failed") }
            }
            return
        }
        worker.execute {
            val directory = File(activity.cacheDir, "updates").apply { mkdirs() }
            val partial = File(directory, "pending.part")
            val ready = File(directory, "verified.apk")
            try {
                val value = manifest()
                val current = installed()
                require(value.getString("version") == requested && value.getLong("versionCode") > code(current))
                val conn = connection(value.getString("url"))
                val digest = MessageDigest.getInstance("SHA-256")
                var length = 0L
                try {
                    conn.inputStream.use { input -> partial.outputStream().use { output ->
                        val buffer = ByteArray(65536)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            length += count
                            require(length <= value.getLong("size") && length <= maxApk)
                            digest.update(buffer, 0, count)
                            output.write(buffer, 0, count)
                        }
                        output.fd.sync()
                    } }
                } finally { conn.disconnect() }
                UpdatePolicy.downloaded(length, value.getLong("size"),
                    digest.digest().joinToString("") { "%02x".format(it) }, value.getString("sha256"))
                val archive = activity.packageManager.getPackageArchiveInfo(partial.absolutePath, PackageManager.GET_SIGNATURES) ?: error("apk_invalid")
                val oldSignatures = current.signatures?.map { it.toCharsString() }?.toSet() ?: error("signer_missing")
                val newSignatures = archive.signatures?.map { it.toCharsString() }?.toSet() ?: error("signer_missing")
                UpdatePolicy.compatible(activity.packageName, archive.packageName, code(current),
                    code(archive), value.getLong("versionCode"), archive.versionName, requested,
                    oldSignatures, newSignatures)
                require(partial.renameTo(ready))
                activity.runOnUiThread {
                    try {
                        val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", ready)
                        activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                        invoke.resolve()
                    } catch (_: Exception) { invoke.reject("update_installer_failed") }
                }
            } catch (_: Exception) {
                partial.delete()
                invoke.reject("update_verification_or_download_failed")
            }
        }
    }
}
