/* ============================================================
   weather.js —— 天气与穿衣（规格书 第 18 章）
   · 数据源 Open-Meteo（免费、免密钥，不需要任何环境变量）  18.1
   · 位置隐私：定位四舍五入到 2 位小数；手动选城市只存城市名  18.2
   · 只允许三种用户发起的触发：被问到 / 打开卡片 / 主动开每天一句  18.3
   · 注入格式 + system 约束（只在这一轮注入，不写入历史）      18.4
   · 温度判断表写死在代码里                                    18.5
   · 卡片 UI：纯文字/SVG，不用 emoji、不用渐变                18.7
   · 拿不到就说拿不到，绝不编造                                18.8

   对外：
   window.Aura.weather = {
     init, fetchNow, getCached, describe, tempAdvice,
     buildContextLine, injectForTurn, maybeDailyTip, setCity, locate
   }
   ============================================================ */
(function () {
  "use strict";

  var A = window.Aura = window.Aura || {};

  /* ---------------- 常量 ---------------- */
  var FORECAST = "https://api.open-meteo.com/v1/forecast";
  var GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
  var TTL = 30 * 60 * 1000;          /* 天气数据缓存 30 分钟 */
  var TIP_KEY = "aura_wx_tip_date";  /* 每天一句的日期标记（新增 key，不动既有契约） */

  /* 18.4 的 system 约束原文 */
  var SYSTEM_RULE =
    "拿到天气信息时，只在用户问到、或与之直接相关时才提；" +
    "提的时候给具体建议（穿什么、带不带伞、要不要加一件），" +
    "不要说\"注意保暖\"\"记得穿衣\"这类空话。";

  /* WMO 天气代码 → 中文短描述（不用 emoji） */
  var WMO = {
    0: "晴", 1: "大部晴朗", 2: "局部多云", 3: "阴",
    45: "有雾", 48: "雾凇",
    51: "小毛毛雨", 53: "毛毛雨", 55: "大毛毛雨",
    56: "冻毛毛雨", 57: "强冻毛毛雨",
    61: "小雨", 63: "中雨", 65: "大雨",
    66: "冻雨", 67: "强冻雨",
    71: "小雪", 73: "中雪", 75: "大雪", 77: "米雪",
    80: "阵雨", 81: "强阵雨", 82: "暴雨",
    85: "阵雪", 86: "强阵雪",
    95: "雷阵雨", 96: "雷阵雨伴冰雹", 99: "强雷阵雨伴冰雹"
  };

  /* 用户问到天气/穿衣/出门时才会用到（18.3） */
  var WX_WORDS = [
    "天气", "气温", "温度", "多少度", "冷不冷", "热不热", "冷吗", "热吗",
    "会不会冷", "会不会热", "下雨", "下雪", "雨大", "雪大", "刮风", "风大",
    "带伞", "带把伞", "雨伞", "要伞", "淋雨", "湿冷", "回南天",
    "穿什么", "穿啥", "穿件", "穿多点", "穿少点", "穿什么好", "衣服", "穿搭",
    "外套", "羽绒服", "加一件", "加件", "日晒", "晒不晒", "出门", "外面"
  ];

  var cache = { at: 0, data: null };
  var fetching = null;
  var loc = { mode: "", name: "", lat: null, lon: null };  /* mode: 'gps' | 'manual' */
  var els = {};
  var inited = false;
  var expanded = false;
  var retryBtn = null;
  var toastTimer = null;
  var modalSnap = null;

  /* ---------------- toast ---------------- */
  function toast(msg) {
    if (A && typeof A.toast === "function") {
      try { A.toast(msg); return; } catch (e) { /* 落回自带实现 */ }
    }
    var el = document.getElementById("toast");
    var before = el ? el.textContent : "";
    if (A && A.bus && typeof A.bus.emit === "function") {
      try { A.bus.emit("toast", msg); } catch (e) { /* ignore */ }
    }
    if (!el) return;
    setTimeout(function () {
      if (el.textContent !== before) return;   /* 已经有别人处理了 */
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
    }, 0);
  }

  /* ---------------- 小工具 ---------------- */
  function on(el, evt, fn) {
    if (el) el.addEventListener(evt, fn);
  }
  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  function txt(s) { return document.createTextNode(s); }
  function round2(v) { return Math.round(v * 100) / 100; }   /* 约 1km 精度 */

  /* 蒲福风级（输入 km/h） */
  function windLevel(kmh) {
    var bound = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
    for (var i = 0; i < bound.length; i++) if (kmh < bound[i]) return i;
    return 12;
  }

  /* 天气代码 → 中文短描述 */
  function describe(code) {
    var c = parseInt(code, 10);
    if (!isFinite(c)) return "";
    return WMO[c] || "天气不明";
  }

  /* 18.5 温度判断表：只做穿衣与出行建议，不做健康说教 */
  function tempAdvice(feels, pop, wind, diff) {
    var f = num(feels);
    var p = num(pop);
    var w = num(wind);
    var d = num(diff);
    var parts = [];

    if (f < 5) {
      parts.push("厚外套或羽绒服，手套围巾带上");
    } else if (f < 12) {
      parts.push(d >= 8 ? "外套加一件内搭，早晚差得多要再加一件" : "外套加一件内搭");
    } else if (f < 20) {
      parts.push(d >= 8 ? "薄外套，早晚有点温差" : "薄外套");
    } else if (f <= 28) {
      parts.push("单件就够，出汗了换一件薄的");
    } else {
      parts.push("穿轻薄点的，注意日晒");
    }

    if (p >= 80) {
      parts.push("大概率下雨，带伞，最好别骑车");
    } else if (p >= 50) {
      parts.push("可能下雨，带把伞");
    }

    if (w >= 5) {
      parts.push("风大，外套挡风");
    }

    if (!parts.length) return "今天这样穿就行。";
    return parts.join("，") + "。";
  }

  /* 这句话是不是在问天气/穿衣/出门 */
  function mentionsWeather(text) {
    if (!text) return false;
    var s = String(text);
    for (var i = 0; i < WX_WORDS.length; i++) {
      if (s.indexOf(WX_WORDS[i]) >= 0) return true;
    }
    return false;
  }

  /* ---------------- 数据获取 ---------------- */

  /* 从存储恢复位置设置（app.js 可能比本模块晚一步 loadAll） */
  function ensureLoc() {
    if (loc.mode) { paintCity(); return; }
    var keys = A.store && A.store.KEYS ? A.store.KEYS : {};
    var city = (A.cfg && A.cfg.city) || "";
    if (city) {
      loc = { mode: "manual", name: city, lat: null, lon: null };
      paintCity();
      return;
    }
    var la = A.store ? A.store.getStr(keys.wxLat, "") : "";
    var lo = A.store ? A.store.getStr(keys.wxLon, "") : "";
    if (la !== "" && lo !== "") {
      loc = { mode: "gps", name: "当前位置", lat: parseFloat(la), lon: parseFloat(lo) };
    }
    paintCity();
  }

  /* 卡片上的城市名 */
  function paintCity() {
    if (!els.city) return;
    var name = "";
    if (loc.mode === "manual" && loc.name) name = loc.name;
    else if (loc.mode === "gps") name = "当前位置";
    else if (A.cfg && A.cfg.city) name = A.cfg.city;
    els.city.textContent = name || "未设置";
  }

  /* 城市名 → 经纬度（中文检索） */
  function geocode(q) {
    var url = GEOCODE + "?name=" + encodeURIComponent(q) + "&count=5&language=zh&format=json";
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("http " + res.status);
      return res.json();
    }).then(function (j) {
      var rs = (j && j.results) || [];
      if (!rs.length) return { ok: false, reason: "notfound" };
      return {
        ok: true,
        name: rs[0].name || q,
        lat: parseFloat(rs[0].latitude),
        lon: parseFloat(rs[0].longitude)
      };
    }).catch(function () {
      return { ok: false, reason: "network" };
    });
  }

  /* 拿到可查询的经纬度（手动模式先 geocoding 一次） */
  function resolveCoords() {
    ensureLoc();
    if (loc.mode === "gps" && loc.lat !== null && loc.lon !== null) {
      return Promise.resolve({ lat: loc.lat, lon: loc.lon });
    }
    if (loc.mode === "manual" && loc.name) {
      if (loc.lat !== null && loc.lon !== null) {
        return Promise.resolve({ lat: loc.lat, lon: loc.lon });
      }
      return geocode(loc.name).then(function (r) {
        if (!r.ok) return null;
        loc.lat = r.lat;
        loc.lon = r.lon;
        return { lat: r.lat, lon: r.lon };
      });
    }
    return Promise.resolve(null);
  }

  /* 解析接口返回 */
  function parseForecast(j, pos) {
    var d = (j && j.daily) || {};
    var times = d.time || [];
    var days = [];
    for (var i = 0; i < times.length && i < 3; i++) {
      var code = d.weather_code ? d.weather_code[i] : null;
      days.push({
        date: times[i],
        label: i === 0 ? "今天" : (i === 1 ? "明天" : "后天"),
        hi: num(d.temperature_2m_max && d.temperature_2m_max[i]),
        lo: num(d.temperature_2m_min && d.temperature_2m_min[i]),
        feels: num(d.apparent_temperature_max && d.apparent_temperature_max[i]),
        pop: num(d.precipitation_probability_max && d.precipitation_probability_max[i]),
        wind: windLevel(num(d.wind_speed_10m_max && d.wind_speed_10m_max[i])),
        code: code,
        text: describe(code)
      });
    }
    var cur = (j && j.current) || {};
    var today = {
      hi: days.length ? days[0].hi : num(cur.temperature_2m),
      lo: days.length ? days[0].lo : 0,
      feels: num(cur.apparent_temperature !== undefined ? cur.apparent_temperature
        : (days.length ? days[0].feels : 0)),
      pop: days.length ? days[0].pop : 0,
      wind: windLevel(num(cur.wind_speed_10m)),
      code: cur.weather_code !== undefined ? cur.weather_code : (days.length ? days[0].code : null),
      text: ""
    };
    today.text = describe(today.code);
    if (days.length) days[0].feels = today.feels;

    return {
      ok: true,
      city: loc.name || "",
      today: today,
      days: days
    };
  }

  /* 取一次天气（30 分钟内直接用缓存） */
  function fetchNow() {
    var c = getCached();
    if (c) return Promise.resolve(c);
    if (fetching) return fetching;

    fetching = resolveCoords().then(function (pos) {
      if (!pos) return { ok: false, reason: "nocity" };
      var url = FORECAST +
        "?latitude=" + pos.lat + "&longitude=" + pos.lon +
        "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m" +
        "&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max," +
        "precipitation_probability_max,wind_speed_10m_max,weather_code" +
        "&forecast_days=3&timezone=auto";
      return fetch(url).then(function (res) {
        if (!res.ok) throw new Error("http " + res.status);
        return res.json();
      }).then(function (j) {
        return parseForecast(j, pos);
      });
    }).then(function (r) {
      fetching = null;
      if (r && r.ok) cache = { at: Date.now(), data: r };
      return r || { ok: false, reason: "network" };
    }, function () {
      fetching = null;
      return { ok: false, reason: "network" };
    });

    return fetching;
  }

  /* 30 分钟内存缓存（天气结果不写 localStorage） */
  function getCached() {
    if (!cache.data) return null;
    if (Date.now() - cache.at > TTL) return null;
    return cache.data;
  }

  /* 18.4 的一行上下文：今日 6–15℃ 体感 4℃，降水 60%，风 3 级；明日 5–12℃ 有雨。 */
  function buildContextLine() {
    var c = getCached();
    if (!c || !c.ok) return "";
    var t = c.today;
    var line = "今日 " + t.lo + "–" + t.hi + "℃ 体感 " + t.feels + "℃，降水 " + t.pop + "%，风 " + t.wind + " 级";
    var d1 = c.days && c.days[1];
    if (d1) line += "；明日 " + d1.lo + "–" + d1.hi + "℃ " + d1.text + "。";
    else line += "。";
    return line;
  }

  /* 这句话要不要带天气上下文；带就返回一行，拿不到就说拿不到（绝不编造） */
  function injectForTurn(text) {
    if (!mentionsWeather(text)) return "";
    var c = getCached();
    if (c && c.ok) return buildContextLine();
    /* 没有数据：明说没取到，同时后台补一次，用户可以手动选城市 */
    if (A.bus && typeof A.bus.emit === "function") {
      try { A.bus.emit("weather:need-city"); } catch (e) { /* ignore */ }
    }
    ensureLoc();
    if (loc.mode) fetchNow();
    else ensureCity();
    return "天气没取到。";
  }

  /* 异步版：适合在发请求前 await（chat.js 推荐用这个） */
  function contextForTurn(text) {
    if (!mentionsWeather(text)) return Promise.resolve("");
    var c = getCached();
    if (c && c.ok) return Promise.resolve(buildContextLine());
    ensureLoc();
    if (!loc.mode) {
      return ensureCity().then(function () {
        var cc = getCached();
        return cc && cc.ok ? buildContextLine() : "天气没取到。";
      });
    }
    return fetchNow().then(function (r) {
      if (r && r.ok) return buildContextLine();
      return "天气没取到。";
    });
  }

  /* 本地日期（不要用 UTC，夜里会差一天） */
  function todayKey() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /* 每天第一次打开时提一句（用户主动开启后才有；每天最多一次） */
  function maybeDailyTip() {
    if (!A.cfg || !A.cfg.weatherOn || !A.cfg.weatherDaily) return Promise.resolve("");
    var today = todayKey();
    if (A.store.getStr(TIP_KEY, "") === today) return Promise.resolve("");
    ensureLoc();
    if (!loc.mode) return Promise.resolve("");

    return fetchNow().then(function (r) {
      if (!r || !r.ok) return "";
      A.store.setStr(TIP_KEY, today);
      var t = r.today;
      var diff = num(t.hi) - num(t.lo);
      var tip = "今天 " + t.lo + "–" + t.hi + "℃，体感 " + t.feels + "℃。" +
        tempAdvice(t.feels, t.pop, t.wind, diff);
      if (A.bus && typeof A.bus.emit === "function") {
        try { A.bus.emit("weather:daily-tip", tip); } catch (e) { /* ignore */ }
      }
      return tip;
    });
  }

  /* ---------------- 城市 / 定位 ---------------- */

  /* 手动选城市：只把城市名存进 aura_city */
  function setCity(name) {
    var q = String(name || "").trim();
    if (!q) return Promise.resolve({ ok: false, reason: "empty" });
    return geocode(q).then(function (r) {
      if (!r.ok) {
        toast(r.reason === "notfound" ? "没找到这个城市。换个写法试试。" : "天气没取到。");
        return { ok: false, reason: r.reason };
      }
      var keys = A.store.KEYS || {};
      A.save.city(r.name);
      A.store.del(keys.wxLat);
      A.store.del(keys.wxLon);
      loc = { mode: "manual", name: r.name, lat: r.lat, lon: r.lon };
      cache = { at: 0, data: null };
      paintCity();
      return fetchNow().then(function (res) {
        render(res);
        return res;
      });
    });
  }

  /* 用当前位置：坐标四舍五入到 2 位小数后再查，不保存原始精确坐标 */
  function doLocate() {
    if (!navigator.geolocation) {
      toast("这个设备没法定位，选个城市也行。");
      return askCityName();
    }
    return new Promise(function (resolve) {
      navigator.geolocation.getCurrentPosition(function (pos) {
        var lat = round2(pos.coords.latitude);
        var lon = round2(pos.coords.longitude);
        var keys = A.store.KEYS || {};
        A.store.setStr(keys.wxLat, String(lat));
        A.store.setStr(keys.wxLon, String(lon));
        A.save.city("");
        loc = { mode: "gps", name: "当前位置", lat: lat, lon: lon };
        cache = { at: 0, data: null };
        paintCity();
        fetchNow().then(function (r) {
          render(r);
          resolve(r && r.ok);
        });
      }, function () {
        /* 拒绝授权：自动回落到手动选城市，不报错、不阻塞 */
        toast("选个城市也行。");
        askCityName().then(resolve);
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
    });
  }

  function locate(skipNotice) {
    if (skipNotice) return doLocate();
    return ensureNotice().then(function (act) {
      if (act === "manual") return askCityName();
      return doLocate();
    });
  }

  /* ---------------- 弹窗（用 #modal + #modal-extra） ---------------- */

  function mkBtn(label, cls, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = cls || "btn";
    b.textContent = label;
    if (fn) b.addEventListener("click", fn);
    return b;
  }

  function btnRow() {
    var wrap = document.createElement("div");
    wrap.setAttribute("style", "display:flex;gap:10px;flex-wrap:wrap;");
    return wrap;
  }

  function snapModal() {
    if (modalSnap) return modalSnap;
    var ok = document.getElementById("modal-ok");
    var cancel = document.getElementById("modal-cancel");
    modalSnap = {
      okHidden: ok ? !!ok.hidden : false,
      okText: ok ? ok.textContent : "",
      cancelHidden: cancel ? !!cancel.hidden : false
    };
    return modalSnap;
  }

  /* 通用弹窗：内容全部放 #modal-extra，用完还原成原来的样子 */
  function showModal(text, build) {
    var modal = document.getElementById("modal");
    var scrim = document.getElementById("modal-scrim");
    var t = document.getElementById("modal-text");
    var extra = document.getElementById("modal-extra");
    var ok = document.getElementById("modal-ok");
    var cancel = document.getElementById("modal-cancel");
    if (!modal || !extra || !t) return Promise.resolve(false);

    snapModal();
    t.textContent = text;
    extra.textContent = "";
    if (ok) ok.hidden = true;
    if (cancel) cancel.hidden = true;
    modal.hidden = false;
    if (scrim) scrim.hidden = false;

    return new Promise(function (resolve) {
      function done(v) {
        modal.hidden = true;
        if (scrim) scrim.hidden = true;
        extra.textContent = "";
        if (ok) { ok.hidden = modalSnap.okHidden; ok.textContent = modalSnap.okText; }
        if (cancel) cancel.hidden = modalSnap.cancelHidden;
        resolve(v);
      }
      try { build(extra, done); }
      catch (e) { done(false); }
    });
  }

  /* 首次使用天气功能的一次说明：两个选项 */
  function ensureNotice() {
    var keys = A.store.KEYS || {};
    if (A.store.getStr(keys.wxNotice, "") === "1") return Promise.resolve("skip");
    return showModal(
      "天气只用来回答天气、穿什么、要不要出门这类问题。" +
      "用当前位置只保留到约 1km 的粗略位置，存在本机不上传；也可以只填城市名。",
      function (extra, done) {
        var row = btnRow();
        row.appendChild(mkBtn("用当前位置", "btn primary", function () {
          A.store.setStr(keys.wxNotice, "1");
          done("locate");
        }));
        row.appendChild(mkBtn("手动选城市", "btn", function () {
          A.store.setStr(keys.wxNotice, "1");
          done("manual");
        }));
        extra.appendChild(row);
      }
    );
  }

  /* 手动填城市名 */
  function askCityName() {
    return showModal("想查哪里的天气？填城市名就行。", function (extra, done) {
      var row = btnRow();
      var input = document.createElement("input");
      input.type = "text";
      input.className = "txt";
      input.placeholder = "比如 北京";
      input.maxLength = 20;
      input.setAttribute("style", "flex:1 1 160px;min-width:120px;");
      var go = function () {
        var v = input.value;
        done(true);
        setCity(v);
      };
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); go(); }
      });
      row.appendChild(input);
      row.appendChild(mkBtn("确定", "btn primary", go));
      extra.appendChild(row);
      setTimeout(function () { try { input.focus(); } catch (e) { /* ignore */ } }, 80);
    });
  }

  /* 还没有城市时给用户一个选择（拒绝定位也不阻塞别的功能） */
  function ensureCity() {
    return ensureNotice().then(function (act) {
      if (act === "locate") return doLocate();
      return askCityName();
    });
  }

  function promptCity() {
    return ensureNotice().then(function (act) {
      if (act === "locate") return doLocate();
      return askCityName();
    });
  }

  /* 卡片右下角小齿轮：改城市 / 重开定位 / 关闭天气功能 */
  function openGear() {
    return showModal("天气设置", function (extra, done) {
      var row = btnRow();
      row.appendChild(mkBtn("改城市", "btn", function () { done(true); promptCity(); }));
      row.appendChild(mkBtn("重开定位", "btn", function () { done(true); locate(); }));
      row.appendChild(mkBtn("关闭天气功能", "btn", function () { done(true); setWeatherOn(false); }));
      extra.appendChild(row);
    });
  }

  /* ---------------- UI ---------------- */

  var SVGNS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
      }
    }
    return e;
  }

  function iconSvg(code) {
    var c = parseInt(code, 10);
    var kind = "cloud";
    if (c === 0) kind = "clear";
    else if (c === 1 || c === 2) kind = "partly";
    else if (c === 3) kind = "cloud";
    else if (c === 45 || c === 48) kind = "fog";
    else if (c >= 51 && c <= 57) kind = "drizzle";
    else if (c >= 61 && c <= 67) kind = "rain";
    else if (c >= 71 && c <= 77) kind = "snow";
    else if (c >= 80 && c <= 82) kind = "rain";
    else if (c === 85 || c === 86) kind = "snow";
    else if (c >= 95) kind = "storm";

    var svg = svgEl("svg", {
      viewBox: "0 0 24 24", width: "20", height: "20",
      fill: "none", stroke: "currentColor", "stroke-width": "1.5",
      "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true"
    });

    function sun(cx, cy, r) {
      svg.appendChild(svgEl("circle", { cx: cx, cy: cy, r: r }));
      var rays = [[0, -1], [0, 1], [-1, 0], [1, 0], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]];
      for (var i = 0; i < rays.length; i++) {
        var x = rays[i][0], y = rays[i][1];
        svg.appendChild(svgEl("line", {
          x1: cx + x * (r + 1.2), y1: cy + y * (r + 1.2),
          x2: cx + x * (r + 3.2), y2: cy + y * (r + 3.2)
        }));
      }
    }
    function cloud(dx, dy) {
      svg.appendChild(svgEl("path", {
        d: "M7.2 18h8.4a3.4 3.4 0 0 0 .3-6.8A5.1 5.1 0 0 0 6.5 12.4 2.8 2.8 0 0 0 7.2 18z",
        transform: "translate(" + dx + "," + dy + ")"
      }));
    }

    if (kind === "clear") {
      sun(12, 12, 4);
    } else if (kind === "partly") {
      sun(9, 8.5, 2.8);
      cloud(0.6, 2.4);
    } else if (kind === "cloud") {
      cloud(0, 0);
    } else if (kind === "fog") {
      svg.appendChild(svgEl("path", { d: "M6 10h12" }));
      svg.appendChild(svgEl("path", { d: "M7.5 14h9" }));
      svg.appendChild(svgEl("path", { d: "M6 18h12" }));
    } else if (kind === "drizzle") {
      cloud(0, -1.4);
      svg.appendChild(svgEl("path", { d: "M10 19.5l-.6 1.6" }));
      svg.appendChild(svgEl("path", { d: "M14 19.5l-.6 1.6" }));
    } else if (kind === "rain") {
      cloud(0, -2);
      svg.appendChild(svgEl("path", { d: "M9.5 19l-.8 2" }));
      svg.appendChild(svgEl("path", { d: "M13 19l-.8 2" }));
      svg.appendChild(svgEl("path", { d: "M16.2 19l-.8 2" }));
    } else if (kind === "snow") {
      cloud(0, -2);
      svg.appendChild(svgEl("path", { d: "M10 19.6h.01M14 19.6h.01M11.6 21.4h.01" }));
    } else if (kind === "storm") {
      cloud(0, -2.4);
      svg.appendChild(svgEl("path", { d: "M13 17.4l-2.6 3.2h2.2l-1 2.6 3.2-4h-2.3z" }));
    }
    return svg;
  }

  function setDesc(text, code) {
    if (!els.desc) return;
    /* 重设描述前先把"重试"按钮摘掉，否则它会被 textContent 一起清空 */
    if (retryBtn) {
      if (retryBtn.parentNode) retryBtn.parentNode.removeChild(retryBtn);
      retryBtn = null;
    }
    els.desc.textContent = "";
    if (code !== undefined && code !== null) {
      var ic = iconSvg(code);
      ic.setAttribute("style", "vertical-align:-3px;margin-right:6px;");
      els.desc.appendChild(ic);
    }
    if (text) els.desc.appendChild(txt(text));
  }

  function showRetry() {
    if (!els.desc) return;
    if (retryBtn) return;
    retryBtn = mkBtn("重试", "btn", function () { refresh(true); });
    retryBtn.setAttribute("style", "margin-left:10px;padding:2px 10px;font-size:12px;");
    els.desc.appendChild(retryBtn);
  }

  function hideRetry() {
    if (retryBtn && retryBtn.parentNode) retryBtn.parentNode.removeChild(retryBtn);
    retryBtn = null;
  }

  function renderDays() {
    if (!els.days) return;
    els.days.textContent = "";
    var c = getCached();
    if (!c || !c.ok) return;
    c.days.forEach(function (d) {
      var row = document.createElement("div");
      row.setAttribute("style", "display:flex;gap:10px;flex-wrap:wrap;align-items:baseline;");
      var a = document.createElement("span");
      a.textContent = d.label;
      var b = document.createElement("span");
      b.textContent = d.lo + "–" + d.hi + "℃";
      var e = document.createElement("span");
      e.textContent = d.text;
      var f = document.createElement("span");
      f.textContent = "降水 " + d.pop + "%";
      var g = document.createElement("span");
      g.textContent = "风 " + d.wind + " 级";
      row.appendChild(a);
      row.appendChild(b);
      row.appendChild(e);
      row.appendChild(f);
      row.appendChild(g);
      els.days.appendChild(row);
    });
  }

  function render(data) {
    if (!els.card) return;
    if (!data || !data.ok) {
      setDesc("天气没取到");
      showRetry();
      return;
    }
    hideRetry();
    if (els.city) els.city.textContent = data.city || "未知城市";
    if (els.temp) {
      els.temp.textContent = (data.today.lo !== null && data.today.lo !== undefined)
        ? (data.today.lo + "–" + data.today.hi + "℃")
        : (data.today.hi + "℃");
    }
    var extra = data.today.pop >= 50 ? " · 带伞" : "";
    setDesc(data.today.text + " · 体感 " + data.today.feels + "℃" + extra, data.today.code);
    renderDays();
  }

  /* 取一次（缓存里没有就现取） */
  function refresh(force) {
    if (!A.cfg || !A.cfg.weatherOn) {
      setDesc("天气功能已关闭");
      return Promise.resolve(false);
    }
    var c = getCached();
    if (c && !force) {
      render(c);
      return Promise.resolve(true);
    }
    ensureLoc();
    if (!loc.mode) {
      setDesc("先选个城市，或者用当前位置");
      ensureCity();
      return Promise.resolve(false);
    }
    setDesc("正在取…");
    return fetchNow().then(function (r) {
      render(r);
      return !!(r && r.ok);
    });
  }

  function setWeatherOn(v) {
    A.save.weatherOn(!!v);
    syncSwitches();
    if (!v) {
      setDesc("天气功能已关闭");
    } else {
      refresh();
    }
  }

  function setDaily(v) {
    A.save.weatherDaily(!!v);
    syncSwitches();
    if (v) maybeDailyTip();
  }

  function syncSwitches() {
    var on = !!(A.cfg && A.cfg.weatherOn);
    var daily = !!(A.cfg && A.cfg.weatherDaily);
    if (els.toggle) {
      els.toggle.setAttribute("aria-checked", on ? "true" : "false");
    }
    if (els.daily) {
      els.daily.setAttribute("aria-checked", daily ? "true" : "false");
    }
  }

  function makeGear() {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "icon-btn";
    b.setAttribute("aria-label", "天气设置");
    b.setAttribute("title", "天气设置");
    b.setAttribute("style", "position:absolute;right:6px;bottom:6px;");
    var svg = svgEl("svg", {
      viewBox: "0 0 24 24", width: "15", height: "15", fill: "none",
      stroke: "currentColor", "stroke-width": "1.6", "aria-hidden": "true"
    });
    svg.appendChild(svgEl("circle", { cx: "12", cy: "12", r: "3.2" }));
    svg.appendChild(svgEl("path", { d: "M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18" }));
    b.appendChild(svg);
    on(b, "click", function (e) {
      e.stopPropagation();
      openGear();
    });
    return b;
  }

  /* 用户在输入框里提到天气时先预热缓存，发送时就不用等网络 */
  function watchInput() {
    var input = document.getElementById("input");
    if (!input) return;
    on(input, "input", function () {
      if (!A.cfg || !A.cfg.weatherOn) return;
      if (!mentionsWeather(input.value)) return;
      if (getCached()) return;
      ensureLoc();
      if (loc.mode) fetchNow();
    });
  }

  function init() {
    if (inited) return;
    inited = true;

    els.card = document.getElementById("wx-card");
    els.city = document.getElementById("wx-city");
    els.temp = document.getElementById("wx-temp");
    els.desc = document.getElementById("wx-desc");
    els.days = document.getElementById("wx-days");
    els.btnCity = document.getElementById("btn-wx-city");
    els.btnLocate = document.getElementById("btn-wx-locate");
    els.toggle = document.getElementById("btn-wx-toggle");
    els.daily = document.getElementById("in-wx-daily");

    if (els.card) {
      /* 卡片样式：--surface 背景、1px --line、14px 圆角（18.7） */
      els.card.style.background = "var(--surface)";
      els.card.style.border = "1px solid var(--line)";
      els.card.style.borderRadius = "14px";
      els.card.style.position = "relative";
      els.card.appendChild(makeGear());
    }
    if (els.days) els.days.style.display = "none";

    on(els.btnCity, "click", function () { promptCity(); });
    on(els.btnLocate, "click", function () { locate(); });
    on(els.toggle, "click", function () { setWeatherOn(!(A.cfg && A.cfg.weatherOn)); });
    on(els.daily, "click", function () { setDaily(!(A.cfg && A.cfg.weatherDaily)); });

    on(els.card, "click", function (e) {
      if (e.target && e.target.closest && e.target.closest("button")) return;
      expanded = !expanded;
      if (els.days) els.days.style.display = expanded ? "" : "none";
      if (expanded) refresh();
    });

    watchInput();
    syncSwitches();
    ensureLoc();
    paintCity();

    /* 天气结果不写 localStorage；只有「每天一句」是用户主动开着的才会去取一次 */
    if (A.cfg && A.cfg.weatherOn && A.cfg.weatherDaily) maybeDailyTip();
  }

  A.weather = {
    init: init,
    fetchNow: fetchNow,
    getCached: getCached,
    describe: describe,
    tempAdvice: tempAdvice,
    buildContextLine: buildContextLine,
    injectForTurn: injectForTurn,
    maybeDailyTip: maybeDailyTip,
    setCity: setCity,
    locate: locate,
    /* 扩展（方便 app.js / chat.js 对接） */
    contextForTurn: contextForTurn,
    systemRule: function () { return SYSTEM_RULE; },
    SYSTEM_RULE: SYSTEM_RULE
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
