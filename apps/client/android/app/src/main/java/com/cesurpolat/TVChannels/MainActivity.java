package com.cesurpolat.TVChannels;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	@Override
	public void onCreate(Bundle savedInstanceState) {
		registerPlugin(ApkDownloaderPlugin.class);
		super.onCreate(savedInstanceState);
	}
}
