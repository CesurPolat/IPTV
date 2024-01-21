package com.cesurpolat.iptv;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Looper;
import android.util.Log;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.widget.VideoView;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.fragment.app.FragmentActivity;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/*
 * Main Activity class that loads {@link MainFragment}.
 */
public class MainActivity extends FragmentActivity {

    int selectedTV=0;
    VideoView videoView;
    WebView webView;
    ActivityResultLauncher<Intent> mtvId;

    ArrayList<String> tvsName = new ArrayList<String>();
    ArrayList<String> tvs = new ArrayList<String>();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        videoView = (VideoView) findViewById(R.id.videoView);
        webView = (WebView) findViewById(R.id.webView);

        webView.getSettings().setJavaScriptEnabled(true);

        tvsName.add("TRT 1");
        tvs.add("https://trt.daioncdn.net/trt-1/master_720p.m3u8?&sid=61j6czd3n8zf&app=ed3904e8-737b-4a5e-856a-1b0d7a0a94e2&ce=2");

        LoadTVS();

        mtvId=registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), new ActivityResultCallback<ActivityResult>(){
            @Override
            public void onActivityResult(ActivityResult result) {
                selectedTV=result.getData().getIntExtra("tvId",0);
                changeVideo();
            }
        });

        videoView.setVideoURI(Uri.parse(tvs.get(selectedTV)));
    }

    @Override
    protected void onResume() {
        super.onResume();
        videoView.start();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP:
                if(selectedTV!=0){
                    selectedTV--;
                    changeVideo();

                }
                return true;
            case KeyEvent.KEYCODE_DPAD_DOWN:
                if(selectedTV!=tvs.size()-1){
                    selectedTV++;
                    changeVideo();

                }
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
                if(videoView.isPlaying()){
                    videoView.pause();
                }else {
                    videoView.start();
                }
                return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                LoadTVS();
                //videoView.seekTo(videoView.getCurrentPosition()+5000);
                return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
                for(int i=0;i<tvsName.size();i++){
                    Log.d("Debug",tvsName.get(i).toString());
                    Log.d("Debug",tvs.get(i).toString());

                }
                //videoView.seekTo(videoView.getCurrentPosition()-5000);

                return true;
            case KeyEvent.KEYCODE_BACK:
                Intent intent = new Intent(this, MainActivity2.class);
                intent.putExtra("tvName",tvsName);
                intent.putExtra("tvs",tvs);
                mtvId.launch(intent);
                return true;

        }
        return false;
    }

    void changeVideo(){
        videoView.setVideoURI(Uri.parse(tvs.get(selectedTV)));
        videoView.start();
    }

    void LoadTVS(){
        OkHttpClient client = new OkHttpClient();

        Request request = new Request.Builder().url("https://iptv-603b2-default-rtdb.firebaseio.com/.json").build();

        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                e.printStackTrace();
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {

                if(response.isSuccessful()){
                    String myResponse = response.body().string();
                    try {
                        JSONObject obj = new JSONObject(myResponse);
                        JSONArray tvsArr = obj.getJSONArray("tvs");
                        tvsName=new ArrayList<>();
                        tvs=new ArrayList<>();

                        addTV(tvsArr,0);

                    } catch (JSONException e) {
                        throw new RuntimeException(e);
                    }


                }

            }
        });
    }



    void addTV(JSONArray tvsArr, int i) throws JSONException {
        JSONObject object = new JSONObject(tvsArr.get(i).toString());
        tvsName.add(object.getString("name"));

        if(object.getString("url").contains(".m3u")){
            tvs.add(object.getString("url"));

            if(i<tvsArr.length()-1){
                try {
                    addTV(tvsArr,(i+1));
                } catch (JSONException e) {
                    throw new RuntimeException(e);
                }
            }else {
                destroyWebView();
            }
        }else {
            JSONObject getM3U = new JSONObject(object.getString("url"));
            String url=getM3U.getString("url");
            String script=getM3U.getString("func");

            Log.d("Debug","Request");

            getHLS(url,script, tv -> {
                tvs.add(tv);

                if(i<tvsArr.length()-1){
                    try {
                        addTV(tvsArr,(i+1));
                    } catch (JSONException e) {
                        throw new RuntimeException(e);
                    }
                }else {
                    destroyWebView();
                }

            });
        }




    }
    public interface OnHLSDataReceivedListener {
        void onDataReceived(String tv);
    }

    String tmp = "ul";

    void getHLS(String url, String script, OnHLSDataReceivedListener listener){


        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                webView.setWebViewClient(new WebViewClient(){
                    @Override
                    public void onPageFinished(WebView view, String url) {

                        // Fox: (fxPlayer.hls.playlists.src)
                        // Atv: (rmpGlobals.inputSettings.src.hls)

                        if (listener != null) {
                            runScript(script,tv -> {
                                listener.onDataReceived(tv);
                            });


                        }


                    }
                });
                Log.d("Debug","To: "+url);

                webView.loadUrl(url);
            }
        });

    }

    public void runScript(String script, OnHLSDataReceivedListener listener){
        new android.os.Handler(Looper.getMainLooper()).postDelayed(
                new Runnable() {
                    @Override
                    public void run() {
                        webView.evaluateJavascript( script, new ValueCallback<String>() {
                            @Override
                            public void onReceiveValue(String s) {
                                Log.d("Debug","From: "+s.substring(1,s.length()-1));




                                if (listener != null) {
                                    if(!s.substring(1,s.length()-1).equals("ul")){
                                        listener.onDataReceived(s.substring(1,s.length()-1));
                                    }else{
                                        Log.d("Debug","Tekrar");

                                        runScript(script,tv -> {
                                            listener.onDataReceived(tv);
                                        });
                                    }

                                }

                            }
                        });
                    }
                },
                500);
    }

    public void destroyWebView() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                ViewGroup mWebContainer =(ViewGroup) findViewById(R.id.main_browse_fragment);
                mWebContainer.removeView(webView);
                webView.clearHistory();
                webView.clearCache(true);
                webView.loadUrl("about:blank");
                webView.onPause();
                webView.removeAllViews();
                webView.destroyDrawingCache();
                webView.pauseTimers();
                webView.destroy();
                webView = null;
                Log.d("Debug","WebView Kaldırıldı!");
                Toast.makeText(getApplicationContext(),"Yükleme Tamamlandı!",Toast.LENGTH_SHORT).show();


            }
        });
    }
}