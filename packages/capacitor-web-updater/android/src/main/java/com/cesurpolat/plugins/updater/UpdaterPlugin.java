package com.cesurpolat.plugins.updater;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.res.AssetManager;
import com.getcapacitor.JSArray;
import java.io.IOException;
import android.util.Log;
import android.content.SharedPreferences;

@CapacitorPlugin(name = "Updater")
public class UpdaterPlugin extends Plugin {

    private Updater implementation;

    private SharedPreferences prefs;
    private SharedPreferences.Editor editor;

    @Override
    public void load() {
        String baseServerUrl = getConfig().getString("baseServerUrl", "https://iptvcdn.cesurpolat.dev");

        implementation = new Updater(baseServerUrl);
    }

    @PluginMethod
    public void echo(PluginCall call) {
        String value = call.getString("value");

        JSObject ret = new JSObject();
        ret.put("value", implementation.echo(value));
        call.resolve(ret);
    }

    @PluginMethod
    public void listAssets(PluginCall call) {
        try {
            AssetManager assetManager = getContext().getAssets();
            String[] files = assetManager.list("public"); // assets/my-folder

            Log.i("EchoFiles", getContext().getFilesDir().toString());

            this.prefs = getContext().getSharedPreferences("CapWebViewSettings", 0);
            this.editor = prefs.edit();
            //editor.putString("serverBasePath", "/data/user/0/com.cesurpolat.TVChannels/files/index.html");
            //editor.commit();
            Log.i("EchoFiles", prefs.getString("serverBasePath", ""));

            JSArray fileArray = new JSArray();
            for (String file : files) {
                fileArray.put(file);
            }
            JSObject result = new JSObject();
            result.put("files", fileArray);
            call.resolve(result);
        } catch (IOException e) {
            call.reject("Failed to list assets", e);
        }
    }

    @PluginMethod
    public void listVersions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("value", implementation.listVersions());
        call.resolve(result);
    }

    @PluginMethod
    public void getVersion(PluginCall call) {
         String value = call.getString("value");

        boolean latestVersion = implementation.getVersion(getContext(), value);
        JSObject ret = new JSObject();
        ret.put("value", latestVersion);
        call.resolve(ret);
    }
}
