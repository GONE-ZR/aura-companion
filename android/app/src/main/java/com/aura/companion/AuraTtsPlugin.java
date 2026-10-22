package com.aura.companion;

import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 原生语音合成（安卓系统 TTS）。
 *
 * 为什么需要它：
 *   · Android WebView **没有** speechSynthesis（Chrome 有，WebView 没有）
 *   · 直连模式下没有服务器就没有 edge-tts
 *   → 所以 APK 里必须走系统 TTS（离线、零延迟）
 *
 * 「声音太机器人」的解法：
 *   · 手机里通常装了好几个 TTS 引擎（系统自带 / 讯飞 / Google / 小米…），
 *     每个引擎又有多个音色（有的带 **神经网络 / neural / 高品质** 版本）
 *   · 默认音色往往是最差的那个 —— 所以这里把**所有引擎的所有音色**都列出来，
 *     前端按「中文 + 女声 + neural/premium 优先」自动挑最好的，也允许手动选
 */
@CapacitorPlugin(name = "AuraTts")
public class AuraTtsPlugin extends Plugin {

    private TextToSpeech tts;
    private boolean ready = false;
    private String defaultEngine = null;

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
                    try {
                        defaultEngine = tts.getDefaultEngine();
                    } catch (Exception e) {
                        defaultEngine = null;
                    }
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
        o.put("defaultEngine", defaultEngine);
        call.resolve(o);
    }

    /* 把 zh-CN-XiaoxiaoNeural 这种 id 变成「晓晓 · 神经网络」 */
    private String prettyLabel(String raw) {
        if (raw == null) return "";
        String s = raw;
        String quality = "";
        String lower = s.toLowerCase(Locale.ROOT);
        if (lower.contains("neural")) quality = " · 神经网络";
        else if (lower.contains("premium")) quality = " · 高品质";
        else if (lower.contains("enhanced")) quality = " · 增强";
        else if (lower.contains("network")) quality = " · 在线";
        /* 去掉语言前缀与质量后缀 */
        s = s.replaceAll("^[a-zA-Z]{2,3}[-_][A-Za-z]{2,4}[-_]?", "");
        s = s.replaceAll("(?i)[-_]?(neural|premium|enhanced|network|local)$", "");
        s = s.replace("_", " ").trim();
        if (s.isEmpty()) s = raw;
        /* 常见英文名 → 中文名（手机里最常见的那几个） */
        String[][] map = {
                {"Xiaoxiao", "晓晓"}, {"Xiaoyi", "晓伊"}, {"Yunxi", "云希"},
                {"Yunjian", "云健"}, {"Yunyang", "云扬"}, {"Xiaobei", "晓北"},
                {"Xiaoni", "晓妮"}, {"Huihui", "慧慧"}, {"Yaoyao", "瑶瑶"},
                {"Kangkang", "康康"}, {"Tingting", "婷婷"}, {"Wan", "婉"},
        };
        for (String[] kv : map) {
            if (s.toLowerCase(Locale.ROOT).contains(kv[0].toLowerCase(Locale.ROOT))) {
                s = s.replace(kv[0], kv[1]);
            }
        }
        return s + quality;
    }

    private int qualityScore(Voice v) {
        String n = (v.getName() == null ? "" : v.getName()).toLowerCase(Locale.ROOT);
        int q = 0;
        if (n.contains("neural")) q += 40;
        if (n.contains("premium")) q += 35;
        if (n.contains("enhanced")) q += 25;
        if (n.contains("network")) q += 10;
        if (v.getLatency() == Voice.LATENCY_LOW) q += 2;
        if (v.isNetworkConnectionRequired()) q -= 1;   /* 离线优先，保证没网也能读 */
        return q;
    }

    /**
     * 列出所有引擎的音色。
     * 返回 { engines:[{name,label}], voices:[{engine,id,label,lang,quality,score}] }
     */
    @PluginMethod
    public void listVoices(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray enginesArr = new JSArray();
        JSArray voicesArr = new JSArray();
        try {
            List<TextToSpeech.EngineInfo> engines = tts.getEngines();
            if (engines != null) {
                for (TextToSpeech.EngineInfo info : engines) {
                    JSObject e = new JSObject();
                    e.put("name", info.name);
                    e.put("label", info.label == null ? info.name : info.label);
                    e.put("isDefault", info.name != null && info.name.equals(defaultEngine));
                    enginesArr.put(e);

                    TextToSpeech probe = new TextToSpeech(getContext(), null, info.name);
                    try {
                        Set<Voice> vs = probe.getVoices();
                        if (vs != null) {
                            for (Voice v : vs) {
                                if (v.getLocale() == null) continue;
                                String lang = v.getLocale().toString().replace("_", "-");
                                if (!lang.toLowerCase(Locale.ROOT).startsWith("zh")) continue;
                                JSObject o = new JSObject();
                                o.put("engine", info.name);
                                o.put("id", v.getName());
                                o.put("label", prettyLabel(v.getName()));
                                o.put("lang", lang);
                                o.put("score", qualityScore(v));
                                o.put("needsNetwork", v.isNetworkConnectionRequired());
                                voicesArr.put(o);
                            }
                        }
                    } catch (Exception ignore) {
                        /* 某些引擎探测会抛异常，跳过即可 */
                    } finally {
                        try { probe.shutdown(); } catch (Exception ignore) { }
                    }
                }
            }
            /* 一个 zh 音色都没探到 → 至少把默认引擎的 zh 音色报上去 */
            if (voicesArr.length() == 0) {
                JSObject o = new JSObject();
                o.put("engine", defaultEngine == null ? "" : defaultEngine);
                o.put("id", "");
                o.put("label", "系统默认中文");
                o.put("lang", "zh-CN");
                o.put("score", 0);
                voicesArr.put(o);
            }
        } catch (Exception e) {
            call.reject("list voices failed: " + e.getMessage());
            return;
        }
        ret.put("engines", enginesArr);
        ret.put("voices", voicesArr);
        call.resolve(ret);
    }

    /** 按 "引擎名::音色名" 选中音色（音色名为空 = 该引擎默认） */
    private boolean applyVoice(String voiceId) {
        if (voiceId == null || voiceId.isEmpty()) return false;
        String engine = null, voiceName = null;
        int sep = voiceId.indexOf("::");
        if (sep > 0) {
            engine = voiceId.substring(0, sep);
            voiceName = voiceId.substring(sep + 2);
        } else {
            voiceName = voiceId;
        }
        try {
            if (engine != null && !engine.isEmpty()) {
                int st = tts.setEngineByPackageName(engine);
                if (st != TextToSpeech.SUCCESS) return false;
            }
            if (voiceName != null && !voiceName.isEmpty()) {
                Set<Voice> vs = tts.getVoices();
                if (vs != null) {
                    for (Voice v : vs) {
                        if (v.getName() != null && v.getName().equals(voiceName)) {
                            return tts.setVoice(v) == TextToSpeech.SUCCESS;
                        }
                    }
                }
            }
            return true;
        } catch (Exception e) {
            return false;
        }
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

        float speechRate = call.getFloat("rate", 1.0f);     /* 0.75 ~ 1.15（相对用户设定） */
        float speechPitch = call.getFloat("pitch", 1.0f);   /* 0.8 ~ 1.2 */
        String voiceId = call.getString("voiceId", "");

        /* 安卓对 pitch 很敏感：把偏移压到 ±0.06 以内，否则会很怪 */
        float r = speechRate / 0.95f;                       /* 安卓 1.0 ≈ 常速 */
        r = Math.max(0.5f, Math.min(1.6f, r * 0.97f));      /* 略慢一点更像人 */
        float p = 1.0f + (speechPitch - 1.0f) * 0.25f;      /* 偏移打 2.5 折 */
        p = Math.max(0.85f, Math.min(1.15f, p));

        if (voiceId != null && !voiceId.isEmpty()) {
            applyVoice(voiceId);
        }

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
        o.put("rate", r);
        o.put("pitch", p);
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
