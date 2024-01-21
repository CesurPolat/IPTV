package com.cesurpolat.iptv;

import androidx.appcompat.app.AppCompatActivity;

import android.content.Intent;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.WebView;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import android.widget.VideoView;

import java.util.ArrayList;

public class MainActivity2 extends AppCompatActivity {

    ArrayList<String> tvsName = new ArrayList<String>();
    ArrayList<String> tvs = new ArrayList<String>();

    VideoView videoView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main2);

        tvsName = (ArrayList<String>) getIntent().getExtras().get("tvName");
        tvs = (ArrayList<String>) getIntent().getExtras().get("tvs");

        videoView=(VideoView) findViewById(R.id.videoView3);

        videoView.setVideoURI(Uri.parse(tvs.get(0)));
        videoView.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
            @Override
            public void onPrepared(MediaPlayer mediaPlayer) {
                // Mute the video
                mediaPlayer.setVolume(0f, 0f);
            }
        });
        videoView.start();

        ListView listemiz=(ListView) findViewById(R.id.listView);

        ArrayAdapter<String> veriAdaptoru=new ArrayAdapter<String>
                (this, android.R.layout.simple_list_item_1, android.R.id.text1, tvsName);

        listemiz.setAdapter(veriAdaptoru);

        listemiz.requestFocus();

        listemiz.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                Intent data = new Intent();
                data.putExtra("tvId", position);
                setResult(RESULT_OK, data);
                finish();
            }
        });

        listemiz.setOnKeyListener(new View.OnKeyListener() {
            @Override
            public boolean onKey(View v, int keyCode, KeyEvent event) {

                if (event.getAction()==KeyEvent.ACTION_UP) {
                    Log.d("Debug", "Key: "+listemiz.getSelectedItemId());
                    videoView.setVideoURI(Uri.parse(tvs.get(Integer.parseInt(listemiz.getSelectedItemId()+""))));
                    videoView.start();
                }
                return false;
            }


        });


    }
}