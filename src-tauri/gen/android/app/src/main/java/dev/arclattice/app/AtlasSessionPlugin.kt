package dev.arclattice.app

import android.app.Activity
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

@InvokeArg
class SessionSaveArgs { var value: String = "" }

/** Native bridge only. Key never leaves Android Keystore; ciphertext is not backed up. */
@TauriPlugin
class AtlasSessionPlugin(private val activity: Activity) : Plugin(activity) {
    private val alias = "orivane.atlas.session.v1"
    private val file get() = File(activity.noBackupFilesDir, "session.v1")
    private val pending get() = File(activity.noBackupFilesDir, "session.pending")
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }
    private fun erase() {
        for (item in listOf(file, pending)) check(!item.exists() || item.delete())
    }
    @Command
    fun load(invoke: Invoke) {
        try {
            var value: String? = null
            if (file.exists()) {
                try {
                    require(file.length() in 29..16384)
                    val bytes = file.readBytes()
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
                    value = String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
                } catch (_: Exception) { erase() }
            }
            invoke.resolve(JSObject().put("value", value ?: JSONObject.NULL))
        } catch (_: Exception) { invoke.reject("SECURE_STORAGE") }
    }
    @Command
    fun save(invoke: Invoke) {
        try {
            val value = invoke.parseArgs(SessionSaveArgs::class.java).value
            require(value.length <= 8192)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            require(cipher.iv.size == 12)
            pending.writeBytes(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)))
            check(pending.renameTo(file))
            invoke.resolve()
        } catch (_: Exception) { invoke.reject("SECURE_STORAGE") }
    }
    @Command
    fun clear(invoke: Invoke) {
        try { erase(); invoke.resolve() }
        catch (_: Exception) { invoke.reject("SECURE_STORAGE") }
    }
}
