package app.orivane.atlas

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.io.ByteArrayInputStream

/** Isolated fixture databases only; no Activity, native vault, provider or remote sync. */
@RunWith(AndroidJUnit4::class)
class LocalStorageWebViewTest {
    @SuppressLint("SetJavaScriptEnabled")
    private fun runProbe(): JSONObject {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val assets = instrumentation.context.assets
        val script = assets.open("storage.js").bufferedReader().use { it.readText() } +
            "\nglobalThis.ATLAS_STORAGE_PROBE_RUNTIME = 'Android WebView';\n" +
            assets.open("probe.js").bufferedReader().use { it.readText() }
        val complete = CountDownLatch(1)
        val result = AtomicReference<String>()
        var view: WebView? = null
        instrumentation.runOnMainSync {
            view = WebView(instrumentation.targetContext).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                webViewClient = object : WebViewClient() {
                    private var invoked = false
                    override fun onPageFinished(webView: WebView, url: String) {
                        if (!invoked) {
                            invoked = true
                            webView.evaluateJavascript(script, null)
                        }
                    }
                    override fun shouldOverrideUrlLoading(webView: WebView, request: WebResourceRequest): Boolean {
                        if (request.url.path == "/result") {
                            result.set(request.url.getQueryParameter("json"))
                            complete.countDown()
                            return true
                        }
                        throw IllegalStateException("Unexpected probe navigation")
                    }
                    override fun shouldInterceptRequest(webView: WebView, request: WebResourceRequest): WebResourceResponse? {
                        if (request.url.path == "/result") {
                            result.set(request.url.getQueryParameter("json"))
                            complete.countDown()
                            return WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream("ok".toByteArray()))
                        }
                        return super.shouldInterceptRequest(webView, request)
                    }
                }
                loadDataWithBaseURL("https://probe.localhost/index", "<!doctype html><title>Local storage probe</title>", "text/html", "UTF-8", null)
            }
        }
        try {
            assertTrue("WebView probe did not finish", complete.await(15, TimeUnit.SECONDS))
            return JSONObject(requireNotNull(result.get()))
        } finally {
            instrumentation.runOnMainSync { view?.destroy() }
        }
    }

    @Test
    fun indexedMetadataAndBlobSurviveWebViewRecreation() {
        val first = runProbe()
        for (result in listOf(first, runProbe())) {
            assertTrue(result.toString(), result.getBoolean("ok"))
            assertEquals("Android WebView", result.getString("runtime"))
            assertTrue(result.getString("userAgent").contains("Android"))
            assertEquals(1500, result.getInt("tasks"))
            assertEquals(500, result.getInt("documents"))
            assertEquals(1000, result.getInt("files"))
            assertEquals(50, result.getInt("outbox"))
            assertTrue(result.getBoolean("staleRejected"))
            assertTrue(result.getBoolean("binaryValid"))
            assertTrue(result.getBoolean("bodyValid"))
            assertTrue(result.getBoolean("stagedAtomic"))
            assertTrue(result.getBoolean("applicationDurable"))
            assertTrue(result.getBoolean("fileDurable"))
            assertTrue(result.getBoolean("identityDurable"))
            assertTrue(result.getBoolean("replicaDurable"))
            assertTrue(result.getBoolean("commandDurable"))
            assertTrue(result.getBoolean("commandAttemptDurable"))
        }
        val recovered = runProbe()
        assertTrue("Metadata lost on WebView recreation", recovered.getBoolean("resumed"))
        assertTrue("Application data lost on WebView recreation", recovered.getBoolean("applicationResumed"))
        assertTrue("Original File lost on WebView recreation", recovered.getBoolean("fileResumed"))
        assertTrue("Canonical receipt lost on WebView recreation", recovered.getBoolean("replicaResumed"))
        assertTrue("Work command lost on WebView recreation", recovered.getBoolean("commandResumed"))
        assertEquals(first.getString("fileId"), recovered.getString("fileId"))
        for (key in listOf("workspaceId", "principalId", "deviceId")) {
            assertEquals(first.getJSONObject("localIdentity").getString(key), recovered.getJSONObject("localIdentity").getString(key))
        }
    }
}
