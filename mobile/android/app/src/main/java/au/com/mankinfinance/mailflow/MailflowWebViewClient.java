package au.com.mankinfinance.mailflow;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.util.Log;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Capacitor's own client swaps in the offline screen for any failed page,
 * including one the server answered with an error status (a 401 from
 * Vercel, a 403, a 404). Those pages say what is wrong, so here they are
 * shown as they are, and the offline screen is kept for pages that never
 * arrived. It then says which: no connection at all, or a connection that
 * didn't reach the site, with the error and address underneath, so a
 * screenshot of it is enough to tell what happened.
 */
public class MailflowWebViewClient extends BridgeWebViewClient {

    private static final String TAG = "Mailflow";
    private static final String ERROR_ASSET = "public/offline.html";
    private static final String PLACEHOLDER = "/*MAILFLOW_ERROR*/null";

    private final Context context;

    public MailflowWebViewClient(Bridge bridge, Context context) {
        super(bridge);
        this.context = context.getApplicationContext();
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        // Deliberately not calling super: it would hide the server's page.
        if (request.isForMainFrame()) {
            Log.w(TAG, "HTTP " + response.getStatusCode() + " for " + request.getUrl());
        }
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (!request.isForMainFrame()) {
            // A failed image or script is the page's business, not ours.
            return;
        }
        String url = String.valueOf(request.getUrl());
        String description = String.valueOf(error.getDescription());
        int code = error.getErrorCode();
        boolean offline = !hasInternet();
        Log.w(TAG, "Page failed: " + code + " " + description + " for " + url + (offline ? " (no connection)" : ""));
        view.stopLoading();
        view.loadDataWithBaseURL(null, errorPage(code, description, url, offline), "text/html", "utf-8", null);
    }

    private boolean hasInternet() {
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return true;
        Network network = cm.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private String errorPage(int code, String description, String url, boolean offline) {
        String html;
        try (InputStream in = context.getAssets().open(ERROR_ASSET)) {
            html = read(in);
        } catch (IOException e) {
            html = "<!doctype html><meta name=viewport content='width=device-width'><body style='font-family:sans-serif;padding:32px'>"
                + "<h1>Mailflow couldn't load</h1><script>var failure = " + PLACEHOLDER + ";</script>"
                + "<p><a href='https://mankin-mailflow.vercel.app/marketing'>Try again</a></p>";
        }
        JSONObject failure = new JSONObject();
        try {
            failure.put("code", code);
            failure.put("description", description);
            failure.put("url", url);
            failure.put("offline", offline);
        } catch (JSONException e) {
            return html;
        }
        // JSONObject escapes "/" so the address can't close the <script>.
        return html.replace(PLACEHOLDER, failure.toString());
    }

    private static String read(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int n;
        while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
        return out.toString(StandardCharsets.UTF_8.name());
    }
}
