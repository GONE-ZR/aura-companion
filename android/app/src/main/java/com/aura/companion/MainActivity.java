package com.aura.companion;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(IconSwitcherPlugin.class);
        registerPlugin(AuraTtsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
