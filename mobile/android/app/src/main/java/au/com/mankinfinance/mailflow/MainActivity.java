package au.com.mankinfinance.mailflow;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The bridge has started loading the live site by now, but no
        // WebView callback runs until onCreate returns, so swapping the
        // client here still covers the very first page.
        if (bridge != null) {
            bridge.setWebViewClient(new MailflowWebViewClient(bridge, this));
        }
    }
}
