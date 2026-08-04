package com.hypnicteen.funworld;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Hypnic Teen — Fun World.
 *
 * A thin shell around the studio's web app. Everything the games need already
 * runs in a browser; what a browser can't do offline is find the host without
 * somebody reading an IP address out loud. So this app scans the local network
 * for the game server and then hands over to a WebView.
 *
 * Deliberately dependency-free: no Gradle, no support libraries, nothing to
 * download. It builds with the SDK tools alone.
 */
public class MainActivity extends Activity {

    private static final int DEFAULT_PORT = 8008;
    private static final int SCAN_TIMEOUT_MS = 350;
    private static final int SCAN_THREADS = 48;

    // Studio palette, matching the site's default skin.
    private static final int PEACH = Color.parseColor("#FFEEE2");
    private static final int SURFACE = Color.parseColor("#FFFAF5");
    private static final int CORAL = Color.parseColor("#F97A5A");
    private static final int INK = Color.parseColor("#2E2118");
    private static final int MUTED = Color.parseColor("#6E5A4C");

    private final Handler ui = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private WebView web;
    private LinearLayout foundList;
    private TextView status;
    private EditText manualField;
    private ExecutorService scanPool;
    private final Set<String> found = Collections.synchronizedSet(new LinkedHashSet<String>());

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences("hypnic", MODE_PRIVATE);

        String last = prefs.getString("server", null);
        if (last != null) {
            openGame(last);
        } else {
            showConnectScreen();
            startScan();
        }
    }

    /* ----------------------------- connect screen ------------------------- */

    private void showConnectScreen() {
        ScrollView scroller = new ScrollView(this);
        scroller.setBackgroundColor(PEACH);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(24);
        root.setPadding(pad, dp(48), pad, pad);

        TextView title = new TextView(this);
        title.setText("HYPNIC TEEN");
        title.setTextColor(INK);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 34);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        root.addView(title);

        TextView sub = new TextView(this);
        sub.setText("Fun World");
        sub.setTextColor(CORAL);
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        sub.setPadding(0, 0, 0, dp(28));
        root.addView(sub);

        status = new TextView(this);
        status.setTextColor(MUTED);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        status.setText("Looking for a game on this WiFi…");
        status.setPadding(0, 0, 0, dp(12));
        root.addView(status);

        foundList = new LinearLayout(this);
        foundList.setOrientation(LinearLayout.VERTICAL);
        root.addView(foundList);

        TextView manualLabel = new TextView(this);
        manualLabel.setText("Or type the address your host gave you");
        manualLabel.setTextColor(MUTED);
        manualLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        manualLabel.setPadding(0, dp(28), 0, dp(8));
        root.addView(manualLabel);

        manualField = new EditText(this);
        manualField.setHint("192.168.1.7:" + DEFAULT_PORT);
        manualField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        manualField.setTextColor(INK);
        manualField.setHintTextColor(Color.parseColor("#9C877A"));
        manualField.setBackgroundColor(SURFACE);
        manualField.setPadding(dp(14), dp(14), dp(14), dp(14));
        root.addView(manualField);

        Button connect = makeButton("Connect", CORAL, Color.WHITE);
        connect.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                String host = manualField.getText().toString().trim();
                if (host.isEmpty()) {
                    toast("Type an address first");
                    return;
                }
                openGame(normalise(host));
            }
        });
        root.addView(connect);

        Button rescan = makeButton("Scan again", SURFACE, INK);
        rescan.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                found.clear();
                foundList.removeAllViews();
                startScan();
            }
        });
        root.addView(rescan);

        TextView help = new TextView(this);
        help.setText(
            "The host runs the studio on their laptop and everyone joins the same "
            + "WiFi or hotspot. No internet needed."
        );
        help.setTextColor(MUTED);
        help.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        help.setPadding(0, dp(28), 0, 0);
        root.addView(help);

        scroller.addView(root);
        setContentView(scroller);
    }

    private Button makeButton(String label, int bg, int fg) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(fg);
        b.setBackgroundColor(bg);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(12);
        b.setLayoutParams(lp);
        return b;
    }

    /* ------------------------------- discovery ---------------------------- */

    /**
     * Sweeps the phone's own /24 for the game server. A plain TCP probe first
     * (fast, most addresses are empty), then one HTTP call to confirm it is
     * actually us and not some other service sitting on the port.
     */
    private void startScan() {
        final List<String> prefixes = localSubnetPrefixes();
        if (prefixes.isEmpty()) {
            setStatus("No local network. Join the host's WiFi or hotspot first.");
            return;
        }
        setStatus("Searching " + prefixes.size() + " network" + (prefixes.size() == 1 ? "" : "s") + " …");

        if (scanPool != null) scanPool.shutdownNow();
        scanPool = Executors.newFixedThreadPool(SCAN_THREADS);

        // Sweep every candidate network, not just the first one — the host can
        // just as easily be across a USB tether as on WiFi.
        for (String prefix : prefixes) {
            for (int i = 1; i <= 254; i++) {
                final String host = prefix + i;
                scanPool.execute(new Runnable() {
                    public void run() {
                        if (!portOpen(host, DEFAULT_PORT)) return;
                        if (!isHypnicServer(host, DEFAULT_PORT)) return;
                        final String address = host + ":" + DEFAULT_PORT;
                        if (found.add(address)) {
                            ui.post(new Runnable() {
                                public void run() { addFound(address); }
                            });
                        }
                    }
                });
            }
        }

        scanPool.shutdown();
        new Thread(new Runnable() {
            public void run() {
                try {
                    scanPool.awaitTermination(25, TimeUnit.SECONDS);
                } catch (InterruptedException ignored) { }
                ui.post(new Runnable() {
                    public void run() {
                        if (found.isEmpty()) {
                            setStatus("No game found. Check you're on the host's WiFi, or type the address below.");
                        } else {
                            setStatus("Found " + found.size() + " — tap to join.");
                        }
                    }
                });
            }
        }).start();
    }

    private void addFound(final String address) {
        Button b = makeButton("Join  " + address, INK, Color.WHITE);
        b.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { openGame("http://" + address); }
        });
        foundList.addView(b);
        setStatus("Found " + found.size() + " — tap to join.");
    }

    private static boolean portOpen(String host, int port) {
        Socket socket = new Socket();
        try {
            socket.connect(new InetSocketAddress(host, port), SCAN_TIMEOUT_MS);
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            try { socket.close(); } catch (Exception ignored) { }
        }
    }

    /** Confirms the health endpoint looks like ours before offering it. */
    private static boolean isHypnicServer(String host, int port) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL("http://" + host + ":" + port + "/api/health");
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(SCAN_TIMEOUT_MS);
            conn.setReadTimeout(700);
            if (conn.getResponseCode() != 200) return false;
            InputStream in = conn.getInputStream();
            byte[] buf = new byte[256];
            int n = in.read(buf);
            in.close();
            String body = n > 0 ? new String(buf, 0, n, "UTF-8") : "";
            return body.contains("\"ok\"") && body.contains("members");
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /**
     * Every local subnet worth sweeping, best first.
     *
     * A phone is usually on several networks at once — WiFi, mobile data, and
     * often USB tethering. Picking whichever the OS lists first is a coin flip,
     * and mobile data is the one guess that can never work: it is a
     * point-to-point /32 with no local network behind it. So: skip the cellular
     * links, skip anything too broad to sweep, and try WiFi before tethering.
     */
    private static List<String> localSubnetPrefixes() {
        List<String> wifi = new ArrayList<String>();
        List<String> tether = new ArrayList<String>();
        List<String> other = new ArrayList<String>();
        try {
            Enumeration<NetworkInterface> nics = NetworkInterface.getNetworkInterfaces();
            while (nics.hasMoreElements()) {
                NetworkInterface nic = nics.nextElement();
                if (!nic.isUp() || nic.isLoopback()) continue;
                String name = nic.getName() == null ? "" : nic.getName().toLowerCase();
                if (name.startsWith("rmnet") || name.startsWith("ccmni") || name.startsWith("pdp")) continue;

                for (java.net.InterfaceAddress ia : nic.getInterfaceAddresses()) {
                    InetAddress addr = ia.getAddress();
                    if (addr == null || addr.isLoopbackAddress()) continue;
                    if (addr.getHostAddress().contains(":")) continue;

                    int bits = ia.getNetworkPrefixLength();
                    if (bits < 22 || bits > 30) continue; // too broad, or point-to-point

                    String ip = addr.getHostAddress();
                    String prefix = ip.substring(0, ip.lastIndexOf('.') + 1);
                    if (name.startsWith("wlan") || name.startsWith("swlan")) wifi.add(prefix);
                    else if (name.startsWith("usb") || name.startsWith("rndis") || name.startsWith("ap")) tether.add(prefix);
                    else other.add(prefix);
                }
            }
        } catch (Exception ignored) { }

        Set<String> ordered = new LinkedHashSet<String>();
        ordered.addAll(wifi);
        ordered.addAll(tether);
        ordered.addAll(other);
        return new ArrayList<String>(ordered);
    }

    private static String normalise(String input) {
        String host = input;
        if (!host.startsWith("http://") && !host.startsWith("https://")) host = "http://" + host;
        if (!host.substring(7).contains(":")) host = host + ":" + DEFAULT_PORT;
        return host;
    }

    /* -------------------------------- the game ---------------------------- */

    @SuppressWarnings("deprecation")
    private void openGame(final String url) {
        // Lets `adb` drive and inspect the page, which is how the automated
        // device check clicks real elements instead of guessing pixel
        // coordinates. Off in the build people actually install — otherwise
        // anyone with a cable could read whatever the page is holding.
        if (BuildFlags.WEB_DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        // The Hypnic ID and session token live in localStorage — without this
        // every player would be signed out each launch.
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // sound effects
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setBackgroundColor(PEACH);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String target) {
                return false; // keep everything inside the app
            }

            @Override
            public void onPageFinished(WebView view, String finished) {
                prefs.edit().putString("server", url).apply();
            }

            @Override
            public void onReceivedError(WebView view, int code, String description, String failing) {
                prefs.edit().remove("server").apply();
                toast("Couldn't reach the game. Is the host still running it?");
                showConnectScreen();
                startScan();
            }
        });

        setContentView(web);
        web.loadUrl(url);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /* -------------------------------- helpers ----------------------------- */

    private void setStatus(String text) {
        if (status != null) status.setText(text);
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }

    private int dp(int value) {
        return (int) TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
    }
}
