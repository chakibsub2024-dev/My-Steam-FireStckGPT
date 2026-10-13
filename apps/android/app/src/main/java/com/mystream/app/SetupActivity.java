package com.mystream.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/** First-run / "Change server" screen: asks for the MyStream server address and checks it. */
public class SetupActivity extends Activity {
    static final String EXTRA_CHANGE = "change";

    private EditText address;
    private TextView status;
    private Button connect;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean tv = TvUtil.isTv(this);
        int pad = dp(tv ? 48 : 24);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad, pad, pad);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setBackgroundColor(Color.rgb(11, 11, 15));

        TextView logo = text("MYSTREAM", tv ? 44 : 34, Color.rgb(229, 9, 20));
        logo.setTypeface(Typeface.DEFAULT_BOLD);
        box.addView(logo);
        box.addView(text(getString(R.string.setup_title), tv ? 26 : 20, Color.WHITE));
        TextView help = text(getString(R.string.setup_help), tv ? 18 : 14, Color.rgb(163, 163, 178));
        help.setPadding(0, dp(8), 0, dp(16));
        box.addView(help);

        address = new EditText(this);
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        address.setHint("http://192.168.1.20:8787");
        address.setTextColor(Color.WHITE);
        address.setHintTextColor(Color.GRAY);
        address.setTextSize(TypedValue.COMPLEX_UNIT_SP, tv ? 24 : 18);
        String current = MainActivity.savedServer(this);
        if (current != null) address.setText(current);
        address.setOnEditorActionListener((v, actionId, ev) -> {
            if (actionId == EditorInfo.IME_ACTION_GO || (ev != null && ev.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                tryConnect();
                return true;
            }
            return false;
        });
        box.addView(address, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        connect = new Button(this);
        connect.setText(R.string.connect);
        connect.setTextSize(TypedValue.COMPLEX_UNIT_SP, tv ? 22 : 16);
        connect.setOnClickListener(v -> tryConnect());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(16);
        box.addView(connect, lp);

        status = text("", tv ? 18 : 14, Color.rgb(255, 107, 107));
        status.setPadding(0, dp(12), 0, 0);
        box.addView(status);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(11, 11, 15));
        scroll.addView(box);
        setContentView(scroll);
        address.requestFocus();
    }

    private TextView text(String s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        return t;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    /** Accepts "192.168.1.20:8787", "http://host:8787/", "https://stream.example.com". */
    static String normalize(String input) {
        String s = input == null ? "" : input.trim();
        if (s.isEmpty()) return null;
        if (!s.matches("(?i)^https?://.*")) s = "http://" + s;
        Uri u = Uri.parse(s);
        if (u.getHost() == null || u.getHost().isEmpty()) return null;
        String origin = u.getScheme().toLowerCase() + "://" + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "");
        return origin;
    }

    private void tryConnect() {
        String origin = normalize(address.getText().toString());
        if (origin == null) {
            status.setText(R.string.bad_address);
            return;
        }
        connect.setEnabled(false);
        status.setTextColor(Color.rgb(163, 163, 178));
        status.setText(getString(R.string.checking, origin));
        new Thread(() -> {
            String error = check(origin);
            runOnUiThread(() -> {
                connect.setEnabled(true);
                if (error == null) {
                    getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE).edit().putString(MainActivity.KEY_SERVER, origin).apply();
                    Intent i = new Intent(this, MainActivity.class);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                    startActivity(i);
                    finish();
                } else {
                    status.setTextColor(Color.rgb(255, 107, 107));
                    status.setText(error);
                }
            });
        }).start();
    }

    /** GET <origin>/api/health; returns null if it is a MyStream server, else a message. */
    static String check(String origin) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(origin + "/api/health").openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(6000);
            c.setInstanceFollowRedirects(true);
            int code = c.getResponseCode();
            if (code != 200) return "The server answered HTTP " + code + ". Is this a MyStream server?";
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
                String line;
                while ((line = r.readLine()) != null && sb.length() < 4096) sb.append(line);
            }
            String body = sb.toString();
            if (!body.contains("\"ok\":true") || !body.contains("\"version\"")) return "That address is not a MyStream server.";
            return null;
        } catch (Exception e) {
            return "Can't connect: " + e.getMessage() + "\nCheck the address, that the server is running and that both devices are on the same network.";
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
