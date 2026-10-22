package app.orivane.atlas

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Own system-bar/cutout/IME accommodation once, outside the WebView.
    // Clearing the handled inset types prevents Chromium/CSS applying them twice.
    val content = findViewById<View>(android.R.id.content)
    val left = content.paddingLeft
    val top = content.paddingTop
    val right = content.paddingRight
    val bottom = content.paddingBottom
    val handled = WindowInsetsCompat.Type.systemBars() or
      WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val safe = insets.getInsets(handled)
      view.setPadding(left + safe.left, top + safe.top, right + safe.right, bottom + safe.bottom)
      WindowInsetsCompat.Builder(insets).setInsets(handled, Insets.NONE).build()
    }
    ViewCompat.requestApplyInsets(content)
  }
}
