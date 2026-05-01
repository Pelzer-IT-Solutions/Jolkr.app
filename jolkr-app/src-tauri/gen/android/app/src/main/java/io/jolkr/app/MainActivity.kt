package io.jolkr.app

import android.Manifest
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

private const val TAG = "JolkrFullscreen"

class MainActivity : TauriActivity() {
  private var customView: View? = null
  private var customViewCallback: WebChromeClient.CustomViewCallback? = null
  private var webViewRef: WebView? = null
  private var cssFullscreenActive = false

  // Created during onCreate so that RustWebChromeClient's internal
  // registerForActivityResult() calls happen before the Activity is STARTED.
  // Creating it later (e.g. in onWebViewCreate) crashes with
  // "LifecycleOwners must call register before they are STARTED".
  private lateinit var rustChromeDelegate: RustWebChromeClient

  // Pending WebView permission request held while we ask the user for runtime
  // perms. Same lifecycle constraint as `rustChromeDelegate`: the launcher
  // must be registered before the Activity transitions to STARTED.
  private var pendingMediaRequest: PermissionRequest? = null
  private var pendingGrantedResources: Array<String> = emptyArray()
  private lateinit var mediaPermLauncher: ActivityResultLauncher<Array<String>>

  private val exitFullscreenOnBack = object : OnBackPressedCallback(false) {
    override fun handleOnBackPressed() {
      when {
        customView != null -> exitHtml5Fullscreen()
        // Iframe / CSS fullscreen — ask JS to exit; fullscreenchange will
        // fire and route back through the JolkrNative bridge.
        cssFullscreenActive -> webViewRef?.evaluateJavascript(
          "document.exitFullscreen && document.exitFullscreen()", null,
        )
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    rustChromeDelegate = RustWebChromeClient(this)
    mediaPermLauncher = registerForActivityResult(
      ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
      val request = pendingMediaRequest ?: return@registerForActivityResult
      val resources = mutableListOf<String>().apply { addAll(pendingGrantedResources) }
      if (results[Manifest.permission.RECORD_AUDIO] == true) {
        resources.add(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
      }
      if (results[Manifest.permission.CAMERA] == true) {
        resources.add(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
      }
      if (resources.isEmpty()) request.deny() else request.grant(resources.toTypedArray())
      pendingMediaRequest = null
      pendingGrantedResources = emptyArray()
    }
    onBackPressedDispatcher.addCallback(this, exitFullscreenOnBack)
  }

  /**
   * Handle a WebView getUserMedia permission request: check OS-level runtime
   * permissions, ask the user for any that are missing, and grant the
   * corresponding WebView resources once approved.
   *
   * Returns `true` if this method consumed the request (caller should NOT
   * delegate it). Returns `false` if the request had no audio/video capture
   * resources we could handle — caller delegates to Tauri.
   */
  fun handleMediaPermissionRequest(request: PermissionRequest): Boolean {
    val grantedNow = mutableListOf<String>()
    val toAsk = mutableListOf<String>()
    var sawMedia = false

    for (resource in request.resources) {
      when (resource) {
        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> {
          sawMedia = true
          if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
              == PackageManager.PERMISSION_GRANTED) {
            grantedNow.add(resource)
          } else {
            toAsk.add(Manifest.permission.RECORD_AUDIO)
          }
        }
        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> {
          sawMedia = true
          if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
              == PackageManager.PERMISSION_GRANTED) {
            grantedNow.add(resource)
          } else {
            toAsk.add(Manifest.permission.CAMERA)
          }
        }
      }
    }

    if (!sawMedia) return false

    if (toAsk.isEmpty()) {
      request.grant(grantedNow.toTypedArray())
    } else {
      pendingMediaRequest = request
      pendingGrantedResources = grantedNow.toTypedArray()
      mediaPermLauncher.launch(toAsk.toTypedArray())
    }
    return true
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewRef = webView
    webView.webChromeClient = FullscreenWebChromeClient(this, rustChromeDelegate)
    // Direct JS→Kotlin bridge. Tauri/Wry intercepts console messages via
    // its own Rust path (the `Tauri/Console` logcat tag), bypassing
    // WebChromeClient.onConsoleMessage — so an addJavascriptInterface
    // bridge is the only reliable way for JS to signal native code from
    // a cross-origin iframe context like VidMount/YouTube embeds.
    webView.addJavascriptInterface(JolkrNativeBridge(this), "JolkrNative")
  }

  fun enterHtml5Fullscreen(view: View, callback: WebChromeClient.CustomViewCallback) {
    Log.d(TAG, "enterHtml5Fullscreen")
    if (customView != null) {
      callback.onCustomViewHidden()
      return
    }
    customView = view
    customViewCallback = callback

    (window.decorView as ViewGroup).addView(
      view,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ),
    )
    setImmersiveMode(true)
  }

  fun exitHtml5Fullscreen() {
    Log.d(TAG, "exitHtml5Fullscreen")
    val view = customView ?: return
    (window.decorView as ViewGroup).removeView(view)
    customView = null
    customViewCallback?.onCustomViewHidden()
    customViewCallback = null
    setImmersiveMode(false)
  }

  fun onCssFullscreenChange(entering: Boolean) {
    Log.d(TAG, "onCssFullscreenChange entering=$entering")
    cssFullscreenActive = entering
    setImmersiveMode(entering)
  }

  private fun setImmersiveMode(immersive: Boolean) {
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    if (immersive) {
      WindowCompat.setDecorFitsSystemWindows(window, false)
      controller.hide(WindowInsetsCompat.Type.systemBars())
      controller.systemBarsBehavior =
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      // SENSOR_LANDSCAPE allows both landscape orientations (rotate the
      // phone left or right) — same UX as YouTube / VidMount's own player.
      requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    } else {
      controller.show(WindowInsetsCompat.Type.systemBars())
      window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      // Force back to portrait — UNSPECIFIED leaves the activity stuck in
      // landscape if auto-rotate is off (the device-state lock that
      // SENSOR_LANDSCAPE imposed doesn't release on its own).
      requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }
    exitFullscreenOnBack.isEnabled = immersive
  }
}

/**
 * Wraps Tauri's auto-generated [RustWebChromeClient] (which is `final` and cannot be
 * subclassed) so we can intercept the HTML5 fullscreen lifecycle while preserving
 * file pickers, permission prompts, JS dialogs, console logging, and the JNI-bound
 * onReceivedTitle handler that Tauri relies on.
 */
private class FullscreenWebChromeClient(
  private val activity: MainActivity,
  private val delegate: RustWebChromeClient,
) : WebChromeClient() {
  override fun onShowCustomView(view: View, callback: CustomViewCallback) {
    activity.enterHtml5Fullscreen(view, callback)
  }

  override fun onHideCustomView() {
    activity.exitHtml5Fullscreen()
  }

  override fun onShowFileChooser(
    webView: WebView,
    filePathCallback: ValueCallback<Array<Uri?>?>,
    fileChooserParams: FileChooserParams,
  ): Boolean = delegate.onShowFileChooser(webView, filePathCallback, fileChooserParams)

  override fun onPermissionRequest(request: PermissionRequest) {
    // Audio/video capture (getUserMedia) goes through our own runtime-perm
    // flow so that mic and camera prompts surface natively. Anything else
    // (geolocation, MIDI, etc.) falls through to Tauri's default handler.
    if (!activity.handleMediaPermissionRequest(request)) {
      delegate.onPermissionRequest(request)
    }
  }

  override fun onGeolocationPermissionsShowPrompt(
    origin: String,
    callback: GeolocationPermissions.Callback,
  ) = delegate.onGeolocationPermissionsShowPrompt(origin, callback)

  override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean =
    delegate.onJsAlert(view, url, message, result)

  override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean =
    delegate.onJsConfirm(view, url, message, result)

  override fun onJsPrompt(
    view: WebView,
    url: String,
    message: String,
    defaultValue: String,
    result: JsPromptResult,
  ): Boolean = delegate.onJsPrompt(view, url, message, defaultValue, result)

  override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean =
    delegate.onConsoleMessage(consoleMessage)

  override fun onReceivedTitle(view: WebView, title: String) =
    delegate.onReceivedTitle(view, title)
}

/**
 * Direct JS→native bridge exposed as `window.JolkrNative` in the WebView.
 * Used so cross-origin iframe embeds (VidMount, YouTube, etc.) can drive
 * the host activity's immersive fullscreen mode when their player CSS-
 * fullscreens an iframe — Android WebView fires neither onShowCustomView
 * nor reachable console messages in that path.
 */
private class JolkrNativeBridge(private val activity: MainActivity) {
  @JavascriptInterface
  fun enterFullscreen() {
    activity.runOnUiThread { activity.onCssFullscreenChange(true) }
  }

  @JavascriptInterface
  fun exitFullscreen() {
    activity.runOnUiThread { activity.onCssFullscreenChange(false) }
  }
}
