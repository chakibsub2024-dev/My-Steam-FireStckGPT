package com.mystream.app;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;

/**
 * MyStream for Android TV, Google TV, Fire TV and phones/tablets.
 * Shows the MyStream web app from the family's MyStream server in a hardened
 * WebView, with TV-remote handling (D-pad, OK, Back, media keys, Menu),
 * pop-up/redirect blocking, ad-host blocking and fullscreen video.
 */
public class MainActivity extends Activity {
    static final String PREFS = "mystream";
    static final String KEY_SERVER = "server";

    private WebView web;
    private FrameLayout root;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private String serverOrigin;
    private boolean tv;
    private long lastBackAt;
    private AdBlock adBlock;
    private final ChromeClient chrome = new ChromeClient();

    static String savedServer(Activity a) {
        return a.getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_SERVER, null);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        serverOrigin = savedServer(this);
        if (serverOrigin == null) {
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }
        tv = TvUtil.isTv(this);
        adBlock = new AdBlock(this);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(11, 11, 15));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        configureWebView();

        if (tv) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            loadHome();
        }
    }

    private String homeUrl() {
        // ?tv=1 switches the web UI to TV mode (big focus rings, remote navigation).
        return serverOrigin + (tv ? "/?tv=1" : "/");
    }

    private void loadHome() {
        web.loadUrl(homeUrl());
    }

    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(true);          // window.open -> onCreateWindow (denied)
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // A MyStream server on the LAN is usually http://; add-on streams may be http too.
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        // Embedded players refuse "app" user agents; present plain mobile/TV Chrome.
        String ua = s.getUserAgentString().replace("; wv)", ")").replaceAll("Version/\\d+(\\.\\d+)* ", "");
        s.setUserAgentString(ua);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        // Prefer a hardware-backed video surface on Fire OS devices.
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setBackgroundColor(Color.rgb(11, 11, 15));
        web.setWebViewClient(new Client());
        web.setWebChromeClient(chrome);
        web.addJavascriptInterface(new Bridge(), "MyStreamAndroid");
        web.setOnFocusChangeListener((v, focused) -> {
            if (focused && tv) web.postDelayed(() -> web.evaluateJavascript(
                    "(function(){if(!document.activeElement||document.activeElement===document.body){var b=document.querySelector('button:not([disabled]),a[href],[tabindex=\"0\"]');if(b)b.focus();}})()", null), 250);
        });
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.requestFocus(View.FOCUS_DOWN);
    }

    // ------------------------------------------------------------------ remote / keys

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        boolean up = e.getAction() == KeyEvent.ACTION_UP;
        switch (code) {
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
                if (up && !e.isCanceled()) handleBack();
                return true;
            case KeyEvent.KEYCODE_BUTTON_A:
                // Some Fire TV remotes send GAMEPAD A instead of DPAD_CENTER.
                if (down) sendKey("Enter");
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
                if (down) sendKey("MediaPlayPause");
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                if (down) sendKey("MediaPlay");
                return true;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_STOP:
                if (down) sendKey("MediaPause");
                return true;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_STEP_FORWARD:
                if (down) sendKey("MediaFastForward");
                return true;
            case KeyEvent.KEYCODE_MEDIA_REWIND:
            case KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD:
            case KeyEvent.KEYCODE_MEDIA_STEP_BACKWARD:
                if (down) sendKey("MediaRewind");
                return true;
            case KeyEvent.KEYCODE_MEDIA_NEXT:
                if (down) sendKey("MediaTrackNext");
                return true;
            case KeyEvent.KEYCODE_CAPTIONS:
                if (down) sendKey("c");
                return true;
            case KeyEvent.KEYCODE_MENU:
            case KeyEvent.KEYCODE_SETTINGS:
                if (up) web.evaluateJavascript("location.hash='#/settings'", null);
                return true;
            case KeyEvent.KEYCODE_SEARCH:
                if (up) web.evaluateJavascript("location.hash='#/search'", null);
                return true;
            default:
                // D-pad arrows, OK/Enter and number keys reach the page as normal
                // keyboard events (ArrowUp/Down/Left/Right, Enter, 0-9).
                return super.dispatchKeyEvent(e);
        }
    }

    /** Deliver a key to the web app (the player listens for Media* keys). */
    private void sendKey(String key) {
        String js = "(function(){var p=document.querySelector('.player');"
                + "var t=document.activeElement&&document.activeElement!==document.body?document.activeElement:(p||document.body);"
                + "if(p&&!p.contains(t))t=p;"
                + "t.dispatchEvent(new KeyboardEvent('keydown',{key:'" + key + "',bubbles:true,cancelable:true}));})()";
        if (web != null) web.evaluateJavascript(js, null);
    }

    @Override
    public void onBackPressed() { // phones: gesture/back button
        handleBack();
    }

    private void handleBack() {
        if (customView != null) {
            web.evaluateJavascript("document.fullscreenElement&&document.exitFullscreen()", null);
            chrome.onHideCustomView();
            return;
        }
        web.evaluateJavascript("(window.msHandleBack?window.msHandleBack():false)", result -> {
            if ("true".equals(result)) return;          // closed a menu/dialog, left the player or went back
            if (web.canGoBack()) { web.goBack(); return; }
            long now = SystemClock.elapsedRealtime();
            if (now - lastBackAt < 2000) {
                finish();
            } else {
                lastBackAt = now;
                Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT).show();
            }
        });
    }

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();   // pauses playback when leaving the app
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("MyStreamAndroid");
            web.destroy();
        }
        super.onDestroy();
    }

    private void setImmersive(boolean on) {
        View decor = getWindow().getDecorView();
        if (on) {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    private void showOffline(String reason) {
        String html = "<html><body style='background:#0b0b0f;color:#f2f2f5;font-family:sans-serif;text-align:center;padding:12vh 6vw'>"
                + "<h1 style='color:#e50914'>MyStream</h1><h2>Can't reach your MyStream server</h2>"
                + "<p style='color:#a3a3b2'>" + escape(serverOrigin) + "<br>" + escape(reason) + "</p>"
                + "<p style='color:#a3a3b2'>Check that the server (or the MyStream PC app with <b>Share on my network</b>) is running.</p>"
                + "<p><button autofocus style='font-size:22px;padding:14px 28px;margin:8px;background:#e50914;color:#fff;border:0;border-radius:8px' onclick='MyStreamAndroid.retry()'>Try again</button>"
                + "<button style='font-size:22px;padding:14px 28px;margin:8px;background:#333;color:#fff;border:0;border-radius:8px' onclick='MyStreamAndroid.changeServer()'>Change server</button></p>"
                + "</body></html>";
        web.loadDataWithBaseURL("about:blank", html, "text/html", "utf-8", null);
    }

    private static String escape(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private boolean isServer(Uri u) {
        Uri base = Uri.parse(serverOrigin);
        return u != null && base.getHost() != null && base.getHost().equalsIgnoreCase(u.getHost())
                && base.getPort() == u.getPort() && String.valueOf(base.getScheme()).equalsIgnoreCase(u.getScheme());
    }

    // ------------------------------------------------------------------ WebView clients

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (!request.isForMainFrame()) return false;                      // frames navigate themselves
            if (isServer(u) || "about".equals(u.getScheme())) return false;   // MyStream itself
            // Anything else trying to take over the window is an ad/redirect: block it.
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String host = request.getUrl().getHost();
            if (adBlock.isBlocked(host)) {
                return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
            }
            return null;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && isServer(request.getUrl())) {
                showOffline(String.valueOf(error.getDescription()));
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
            recreate();
            return true;
        }
    }

    private class ChromeClient extends WebChromeClient {
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
            return false; // no pop-ups, ever
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.setVisibility(View.GONE);
            setImmersive(true);
            view.requestFocus();
        }

        @Override
        public void onHideCustomView() {
            if (customView == null) return;
            root.removeView(customView);
            customView = null;
            web.setVisibility(View.VISIBLE);
            setImmersive(false);
            if (customCallback != null) customCallback.onCustomViewHidden();
            customCallback = null;
            web.requestFocus();
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny(); // no camera/microphone/etc. for any page
        }
    }

    /** Small bridge used by the MyStream web app. No access to files or settings. */
    private class Bridge {
        @JavascriptInterface
        public void keepScreenOn(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public void changeServer() {
            runOnUiThread(() -> {
                Intent i = new Intent(MainActivity.this, SetupActivity.class);
                i.putExtra(SetupActivity.EXTRA_CHANGE, true);
                startActivity(i);
            });
        }

        @JavascriptInterface
        public void retry() {
            runOnUiThread(MainActivity.this::loadHome);
        }

        @JavascriptInterface
        public boolean isTv() {
            return tv;
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }
    }
}
