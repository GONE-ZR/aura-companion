package com.aura.companion;

import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 原生语音合成（安卓系统 TTS）。
 *
 * 为什么需要它：
 *   · Android WebView **没有** speechSynthesis（Chrome 有，WebView 没有）
 *   · 直连模式下没有服务器就没有 edge-tts
 *   → 所以 APK 里必须走系统 TTS（离线、零延迟、有中文女声）
 *
 * 语速/音高：安卓的 setSpeechRate 只认 0.5~2.0，音高没有对应接口，
 * 这里按比例把 edge-tts 那套相对偏移折算过去。
 */
@CapacitorPlugin(name = "AuraTts")
public class AuraTtsPlugin extends Plugin {

    private TextToSpeech tts;
    private boolean ready = false;
    private String pendingVoice = "zh-CN";
    private float rate = 1.0f;
    private float pitch = 1.0f;

    @Override
    public void load() {
        tts = new TextToSpeech(getContext(), new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                if (status == TextToSpeech.SUCCESS) {
                    int r = tts.setLanguage(Locale.CHINA);
                    if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                        tts.setLanguage(Locale.CHINESE);
                    }
                    ready = true;
                    JSObject o = new JSObject();
                    o.put("ready", true);
                    notifyListeners("ttsReady", o);
                }
            }
        });
    }

    @PluginMethod
    public void ready(PluginCall call) {
        JSObject o = new JSObject();
        o.put("ready", ready);
        call.resolve(o);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.resolve(new JSObject());
            return;
        }
        if (!ready) {
            call.reject("tts not ready");
            return;
        }

        float speechRate = call.getFloat("rate", 1.0f);     /* 0.75 ~ 1.15 */
        float speechPitch = call.getFloat("pitch", 1.0f);   /* 0.8 ~ 1.2 */

        /* 安卓 setSpeechRate 的 1.0 ≈ 常速；edge-tts 的 0.95 ≈ 常速 */
        float r = speechRate / 0.95f;
        r = Math.max(0.5f, Math.min(2.0f, r));
        float p = Math.max(0.6f, Math.min(1.6f, speechPitch));

        final String id = "aura-" + System.currentTimeMillis();
        tts.setSpeechRate(r);
        tts.setPitch(p);

        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) { }

            @Override
            public void onDone(String utteranceId) {
                JSObject o = new JSObject();
                o.put("id", utteranceId);
                o.put("done", true);
                notifyListeners("ttsDone", o);
            }

            @Override
            public void onError(String utteranceId, int errorCode) {
                JSObject o = new JSObject();
                o.put("id", utteranceId);
                o.put("error", errorCode);
                notifyListeners("ttsDone", o);
            }

            /* 老版接口，抽象类要求必须实现 */
            @Override
            public void onError(String utteranceId) {
                JSObject o = new JSObject();
                o.put("id", utteranceId);
                o.put("error", -1);
                notifyListeners("ttsDone", o);
            }
        });

        int res = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
        JSObject o = new JSObject();
        o.put("id", id);
        o.put("queued", res == TextToSpeech.SUCCESS);
        call.resolve(o);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve(new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        super.handleOnDestroy();
    }
}
