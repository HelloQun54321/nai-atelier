package io.github.helloqun54321.naiatelier;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(AtelierPlugin.class);
        super.onCreate(state);
    }
}
