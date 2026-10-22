package com.aura.companion;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * 安卓原生语音识别。
 *
 * 为什么需要它：APK 跑在 WebView 里，WebView **没有** window.SpeechRecognition
 * （那是 Chrome 浏览器才有的），所以手机上的“按住说话”必须走系统识别服务。
 *
 * 前端（static/js/voice.js 的 runNativeRecognition）已经在等这个名字的插件：
 *   available({language}) → { available: true }
 *   start({language})     → { matches: [{ transcript: "..." }] }
 */
@CapacitorPlugin(
        name = "SpeechRecognition",
        permissions = {
                @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
        }
)
public class AuraSpeechPlugin extends Plugin {

    private SpeechRecognizer recognizer;
    private PluginCall pendingCall;
    private final Handler main = new Handler(Looper.getMainLooper());

    /** 前端先问一句能不能用，不能就降级成打字 */
    @PluginMethod
    public void available(PluginCall call) {
        boolean ok = SpeechRecognizer.isRecognitionAvailable(getContext());
        JSObject ret = new JSObject();
        ret.put("available", ok);
        ret.put("permission", getPermissionState("microphone").toString());
        call.resolve(ret);
    }

    /** 开始听 → 拿到一句话就 resolve */
    @PluginMethod
    public void start(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("no-recognizer");
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermissionCallback");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void micPermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            doStart(call);
        } else {
            call.reject("not-allowed");
        }
    }

    private void doStart(PluginCall call) {
        if (pendingCall != null) {
            call.reject("busy");
            return;
        }
        pendingCall = call;
        final String lang = call.getString("language", "zh-CN");

        main.post(() -> {
            try {
                if (recognizer == null) {
                    recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                }
                recognizer.setRecognitionListener(new RecognitionListener() {
                    @Override
                    public void onReadyForSpeech(Bundle params) { }

                    @Override
                    public void onBeginningOfSpeech() { }

                    @Override
                    public void onRmsChanged(float rmsdB) { }

                    @Override
                    public void onBufferReceived(byte[] buffer) { }

                    @Override
                    public void onEndOfSpeech() { }

                    @Override
                    public void onError(int error) {
                        finish(null, mapError(error));
                    }

                    @Override
                    public void onResults(Bundle results) {
                        ArrayList<String> list =
                                results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (list != null && !list.isEmpty()) {
                            finish(list.get(0), null);
                        } else {
                            finish(null, "no-speech");
                        }
                    }

                    @Override
                    public void onPartialResults(Bundle partialResults) { }

                    @Override
                    public void onEvent(int eventType, Bundle params) { }
                });

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                recognizer.startListening(intent);
            } catch (Exception e) {
                finish(null, "start-failed");
            }
        });
    }

    /** 用户中途松手 / 页面切走时调用 */
    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            try {
                if (recognizer != null) recognizer.stopListening();
            } catch (Exception ignored) { }
        });
        call.resolve();
    }

    private void finish(String text, String error) {
        PluginCall c = pendingCall;
        pendingCall = null;
        if (c == null) return;
        try {
            if (recognizer != null) recognizer.cancel();
        } catch (Exception ignored) { }

        if (error != null) {
            c.reject(error);
            return;
        }
        JSObject match = new JSObject();
        match.put("transcript", text == null ? "" : text);
        JSObject ret = new JSObject();
        ret.put("matches", new JSObject[]{match});
        c.resolve(ret);
    }

    /** 安卓的错误码 → 前端认得的字符串 */
    private String mapError(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "audio-capture";
            case SpeechRecognizer.ERROR_CLIENT:
                return "aborted";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "not-allowed";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "network";
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "no-speech";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "aborted";
            case SpeechRecognizer.ERROR_SERVER:
                return "network";
            case 13:   // ERROR_LANGUAGE_NOT_SUPPORTED（API31+，用数字保证低 compileSdk 也能编）
                return "language-not-supported";
            case 14:   // ERROR_LANGUAGE_UNAVAILABLE
                return "language-not-supported";
            default:
                return "unknown";
        }
    }
}
