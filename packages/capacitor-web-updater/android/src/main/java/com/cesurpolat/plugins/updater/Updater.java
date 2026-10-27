package com.cesurpolat.plugins.updater;

import android.util.Log;
import android.content.SharedPreferences;
import android.content.Context;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Updater {

    private final String baseServerUrl;

    public Updater(String baseServerUrl) {
        this.baseServerUrl = baseServerUrl;
    }


    public String echo(String value) {
        Log.i("Echo", value);
        return value;
    }

    public String[] listAssetFiles(Context context, String path) {
        try {
            android.content.res.AssetManager assetManager = context.getAssets();
            return assetManager.list(path);
        } catch (Exception e) {
            Log.e("Updater", "Error listing asset files", e);
            return new String[0];
        }
    }

    public String listVersions() {
        String urlString = baseServerUrl + "/versions/";
        java.net.HttpURLConnection conn = null;
        java.io.BufferedReader reader = null;
    
        try {
            java.net.URL url = new java.net.URL(urlString);
            conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
    
            int responseCode = conn.getResponseCode();
            if (responseCode == 200) {
                reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(conn.getInputStream())
                );
    
                StringBuilder html = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    html.append(line);
                }

                List<String> files = extractFileNames(html.toString());
                org.json.JSONArray jsonArray = new org.json.JSONArray();
    
                for (String file : files) {
                    if (file.endsWith(".zip")) {
                        String version = file
                            .replace(".zip", "")
                            .replace("_", ".");
    
                        org.json.JSONObject obj = new org.json.JSONObject();
                        obj.put("version", version);
                        obj.put("url", urlString + file);
    
                        jsonArray.put(obj);
                    }
                }
    
                Log.i("Updater", "JSON " + jsonArray.toString());
                return jsonArray.toString();
            } else {
                Log.e("Updater", "HTTP error code: " + responseCode);
            }
        } catch (Exception e) {
            Log.e("Updater", "Error listing versions", e);
        } finally {
            try {
                if (reader != null) reader.close();
            } catch (Exception ignored) {}
            if (conn != null) conn.disconnect();
        }
    
        return "[]";
    }

    public boolean getVersion(Context context, String versionUrl) {
        String filesDir = context.getFilesDir().getAbsolutePath();
        String zipFilePath = filesDir + "/version.zip";
        String unzipDestDirectory = filesDir + "/www";

        // 1. Download the zip file
        boolean downloadSuccess = download(context, versionUrl);
        if (!downloadSuccess) {
            Log.e("Updater", "Failed to download the version.");
            return false;
        }

        // 2. Delete contents of the destination directory
        java.io.File destDirFile = new java.io.File(unzipDestDirectory);
        if (destDirFile.exists()) {
            boolean deleteSuccess = deleteDirectoryContents(unzipDestDirectory);
            if (!deleteSuccess) {
                Log.e("Updater", "Failed to delete contents of " + unzipDestDirectory);
                // Optionally, try to delete the downloaded zip file if cleanup failed before unzipping
                new java.io.File(zipFilePath).delete();
                return false;
            }
        } else {
            // If directory doesn't exist, try to create it for unzipping
            if (!destDirFile.mkdirs()) {
                Log.e("Updater", "Failed to create destination directory: " + unzipDestDirectory);
                new java.io.File(zipFilePath).delete();
                return false;
            }
        }

        // 3. Unzip the downloaded file
        boolean unzipSuccess = unzip(zipFilePath, unzipDestDirectory);
        if (!unzipSuccess) {
            Log.e("Updater", "Failed to unzip the version.");
            // Optionally, try to delete the downloaded zip file if unzipping failed
            new java.io.File(zipFilePath).delete();
            return false;
        }

        // 4. Update SharedPreferences
        updateServerBasePath(context, "www");

        // Clean up the downloaded zip file after successful unzip
        new java.io.File(zipFilePath).delete();

        Log.i("Updater", "Successfully updated to the version.");
        return true;
    }

    public void updateServerBasePath(Context context, String newPath) {
        SharedPreferences prefs = context.getSharedPreferences("CapWebViewSettings", 0);
        SharedPreferences.Editor editor = prefs.edit();
        java.io.File baseDir = context.getFilesDir();
        java.io.File fullPathFile = new java.io.File(baseDir, newPath);
        String absolutePath = fullPathFile.getAbsolutePath();
        editor.putString("serverBasePath", absolutePath);
        editor.commit();
        Log.i("Updater", "Updated serverBasePath to: " + absolutePath);
    }
   

    public boolean download(Context context, String zipUrl) {
        Log.i("Updater", "downloadZipToFilesDir called with url: " + zipUrl);
        java.io.InputStream input = null;
        java.io.FileOutputStream output = null;
        java.net.HttpURLConnection connection = null;
        try {
            java.net.URL url = new java.net.URL(zipUrl);
            connection = (java.net.HttpURLConnection) url.openConnection();
            connection.connect();
            if (connection.getResponseCode() != java.net.HttpURLConnection.HTTP_OK) {
                Log.e("Updater", "Server returned HTTP " + connection.getResponseCode()
                        + " " + connection.getResponseMessage());
                return false;
            }
            input = connection.getInputStream();
            java.io.File outFile = new java.io.File(context.getFilesDir(), "version.zip");
            output = new java.io.FileOutputStream(outFile);
            byte[] data = new byte[4096];
            int count;
            while ((count = input.read(data)) != -1) {
                output.write(data, 0, count);
            }
            Log.i("Updater", "Zip file downloaded to: " + outFile.getAbsolutePath());
            return true;
        } catch (Exception e) {
            Log.e("Updater", "Error downloading zip file", e);
            return false;
        } finally {
            try {
                if (output != null) output.close();
                if (input != null) input.close();
            } catch (Exception ignored) {}
            if (connection != null) connection.disconnect();
        }
    }

    public boolean unzip(String zipFilePath, String destDirectory) {
        java.io.File destDir = new java.io.File(destDirectory);
        if (!destDir.exists()) {
            destDir.mkdirs();
        }
        java.util.zip.ZipInputStream zis = null;
        try {
            zis = new java.util.zip.ZipInputStream(new java.io.FileInputStream(zipFilePath));
            java.util.zip.ZipEntry zipEntry = zis.getNextEntry();
            byte[] buffer = new byte[4096];
            while (zipEntry != null) {
                java.io.File newFile = newFile(destDir, zipEntry);
                if (zipEntry.isDirectory()) {
                    if (!newFile.isDirectory() && !newFile.mkdirs()) {
                        throw new java.io.IOException("Failed to create directory " + newFile);
                    }
                } else {
                    // fix for Windows-created archives
                    java.io.File parent = newFile.getParentFile();
                    if (!parent.isDirectory() && !parent.mkdirs()) {
                        throw new java.io.IOException("Failed to create directory " + parent);
                    }
                    
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(newFile);
                    int len;
                    while ((len = zis.read(buffer)) > 0) {
                        fos.write(buffer, 0, len);
                    }
                    fos.close();
                }
                zipEntry = zis.getNextEntry();
            }
            zis.closeEntry();
            Log.i("Updater", "Zip file unzipped to: " + destDirectory);
            return true;
        } catch (java.io.IOException e) {
            Log.e("Updater", "Error unzipping file", e);
            return false;
        } finally {
            try {
                if (zis != null) {
                    zis.close();
                }
            } catch (java.io.IOException e) {
                Log.e("Updater", "Error closing ZipInputStream", e);
            }
        }
    }

    // Helper method to prevent Zip Slip vulnerability
    private static java.io.File newFile(java.io.File destinationDir, java.util.zip.ZipEntry zipEntry) throws java.io.IOException {
        java.io.File destFile = new java.io.File(destinationDir, zipEntry.getName());
        String destDirPath = destinationDir.getCanonicalPath();
        String destFilePath = destFile.getCanonicalPath();
        if (!destFilePath.startsWith(destDirPath + java.io.File.separator)) {
            throw new java.io.IOException("Entry is outside of the target dir: " + zipEntry.getName());
        }
        return destFile;
    }

    public boolean deleteDirectoryContents(String directoryPath) {
        java.io.File dir = new java.io.File(directoryPath);
        if (!dir.exists() || !dir.isDirectory()) {
            Log.e("Updater", "Directory does not exist or is not a directory: " + directoryPath);
            return false;
        }
        try {
            java.io.File[] files = dir.listFiles();
            if (files != null) {
                for (java.io.File file : files) {
                    if (file.isDirectory()) {
                        deleteDirectoryContents(file.getAbsolutePath()); // Recursively delete subdirectory contents
                        if (!file.delete()) { // Delete the now-empty subdirectory
                            Log.e("Updater", "Failed to delete directory: " + file.getAbsolutePath());
                            // Optionally, decide if this should halt the whole process or just log and continue
                        }
                    } else {
                        if (!file.delete()) {
                            Log.e("Updater", "Failed to delete file: " + file.getAbsolutePath());
                            // Optionally, decide if this should halt the whole process or just log and continue
                        }
                    }
                }
            }
            Log.i("Updater", "Successfully deleted contents of directory: " + directoryPath);
            return true;
        } catch (Exception e) {
            Log.e("Updater", "Error deleting directory contents: " + directoryPath, e);
            return false;
        }
    }

    public static List<String> extractFileNames(String html) {
        List<String> files = new ArrayList<>();

        Pattern pattern = Pattern.compile("<a[^>]*>([^<]+)</a>", Pattern.CASE_INSENSITIVE);
        Matcher matcher = pattern.matcher(html);

        while (matcher.find()) {
            String text = matcher.group(1).trim();

            if (text.equalsIgnoreCase("[To Parent Directory]")) {
                continue;
            }

            files.add(text);
        }

        return files;
    }

}
