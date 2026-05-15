package com.cesurpolat.TVChannels;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "ApkDownloader")
public class ApkDownloaderPlugin extends Plugin {
    private static final String DEFAULT_FILE_NAME = "IPTV-latest.apk";
    private static final Pattern INVALID_FILE_NAME_CHARS = Pattern.compile("[^A-Za-z0-9._-]");

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("APK URL is required.");
            return;
        }

        Uri apkUri = Uri.parse(url);
        String scheme = apkUri.getScheme();
        if (scheme == null || (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme))) {
            call.reject("Only http/https APK URLs are supported.");
            return;
        }

        String fileName = sanitizeFileName(call.getString("fileName"));
        Context context = getContext();
        DownloadManager downloadManager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);

        if (downloadManager == null) {
            call.reject("DownloadManager is not available on this device.");
            return;
        }

        DownloadManager.Request request = new DownloadManager.Request(apkUri);
        request.setTitle(fileName);
        request.setDescription("IPTV APK indiriliyor");
        request.setMimeType("application/vnd.android.package-archive");
        request.setAllowedOverMetered(true);
        request.setAllowedOverRoaming(true);
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

        try {
            long downloadId = downloadManager.enqueue(request);

            JSObject result = new JSObject();
            result.put("downloadId", downloadId);
            result.put("fileName", fileName);
            result.put("destination", Environment.DIRECTORY_DOWNLOADS + "/" + fileName);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("APK download could not be started.", error);
        }
    }

    private String sanitizeFileName(String rawFileName) {
        String candidate = rawFileName == null ? "" : rawFileName.trim();
        if (candidate.isEmpty()) {
            candidate = DEFAULT_FILE_NAME;
        }

        String sanitized = INVALID_FILE_NAME_CHARS.matcher(candidate).replaceAll("_");
        if (sanitized.isEmpty()) {
            sanitized = DEFAULT_FILE_NAME;
        }

        if (!sanitized.toLowerCase(Locale.ROOT).endsWith(".apk")) {
            sanitized = sanitized + ".apk";
        }

        return sanitized;
    }
}