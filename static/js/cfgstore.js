/* ============================================================
   cfgstore.js —— 三层配置读取 + 原子切换（第七篇 §2/§3/§4）

   读取顺序（永不为空）：
     1. current.json 指针 → gen-N/config.json   （上次成功拉取的）
     2. 扫描最大合法 gen                        （指针写坏时的兜底）
     3. 包体内 config.bundled.json              （打包时固化，永远存在）

   原子切换（顺序不可调换）：
     校验 → 版本只升不降 → 资源键存在 → 资源下载到 gen-N.tmp
     → 逐个校验 size>0 → 写 tmp/config.json → tmp 改名 gen-N
     → 写指针（先 .tmp 再覆盖）→ 清理超过 2 代

   存储用 localStorage（本项目无 Filesystem 插件）：
     一个 key 存一代（aura_cfg_gen_43），指针单独一个 key —— 单次 setItem 即原子。
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraCfg = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var PTR_KEY = "aura_cfg_current";
  var GEN_PREFIX = "aura_cfg_gen_";
  var MAX_GENS = 2;
  var BACKGROUNDS = ["warm", "dusk", "cool", "gray"];

  /* ---------------- 包体内置（ASSET_MAP 的替身） ----------------
     我们把可用资源键写死在这里；远端配置只能引用它，不能凭空加资源。 */
  var ASSET_MAP = {
    "icon.send": 1, "icon.mic": 1, "icon.attach": 1, "icon.wall": 1, "icon.set": 1,
    "expr.calm": 1, "expr.smile": 1, "expr.soft": 1, "expr.tease": 1,
    "expr.sulky": 1, "expr.serious": 1, "expr.blank": 1, "expr.tired": 1,
    "bg.warm": 1, "bg.dusk": 1, "bg.cool": 1, "bg.gray": 1,
    "pack.default": 1, "pack.warm": 1, "pack.blue": 1, "pack.rose": 1, "pack.violet": 1
  };

  function bundled() {
    if (typeof window !== "undefined" && window.AURA_CFG_BUNDLED) return window.AURA_CFG_BUNDLED;
    if (typeof module === "object" && module.exports) {
      try { return require("../config.bundled.json"); } catch (e) { return null; }
    }
    return null;
  }

  /* ---------------- 校验（§3.3） ---------------- */
  function validate(c) {
    if (!c || typeof c !== "object") return false;
    if (c.schemaVersion !== 1) return false;
    if (!Number.isInteger(c.configVersion) || c.configVersion < 1) return false;

    var f = c.features;
    if (!f || typeof f !== "object") return false;
    var keys = ["weather", "reminders", "search", "agentMode", "voiceTts", "lifeLine", "killSwitch"];
    for (var i = 0; i < keys.length; i++) if (typeof f[keys[i]] !== "boolean") return false;

    if (!c.appearance) return false;
    if (BACKGROUNDS.indexOf(c.appearance.background) === -1) return false;
    if (typeof c.appearance.expression !== "string") return false;

    if (!c.copy || typeof c.copy.inputPlaceholder !== "string") return false;
    if (!c.quickReplies || !Array.isArray(c.quickReplies.items)) return false;
    if (c.quickReplies.items.length > 6) return false;

    if (!c.model || typeof c.model.temperature !== "number") return false;
    if (c.model.temperature < 0 || c.model.temperature > 2) return false;
    return true;
  }

  /* 资源键必须存在：包体内，或在 onDemand 清单里 */
  function assetKeysExist(c) {
    var onDemand = (c.assets && c.assets.onDemand) || [];
    var need = [c.appearance.expression, c.appearance.iconPack];
    for (var i = 0; i < need.length; i++) {
      var k = need[i];
      if (!k) continue;
      if (!(k in ASSET_MAP) && onDemand.indexOf(k) === -1) return false;
    }
    return true;
  }

  /* onDemand 资源必须实际存在且非空 */
  function assetsPresent(c, gen) {
    var list = (c.assets && c.assets.onDemand) || [];
    if (!list.length) return true;
    for (var i = 0; i < list.length; i++) {
      var v = null;
      try { v = localStorage.getItem("aura_cfg_asset_" + gen + "_" + list[i]); } catch (e) { v = null; }
      if (!v || v.length === 0) return false;
    }
    return true;
  }

  /* ---------------- 读取（§3.4） ---------------- */
  function readGen(g) {
    try {
      var raw = localStorage.getItem(GEN_PREFIX + g);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function genList() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(GEN_PREFIX) === 0) {
          var g = Number(k.slice(GEN_PREFIX.length));
          if (Number.isInteger(g)) out.push(g);
        }
      }
    } catch (e) { /* ignore */ }
    return out.sort(function (a, b) { return b - a; });
  }

  function loadActive() {
    /* 1. 按指针 */
    try {
      var p = JSON.parse(localStorage.getItem(PTR_KEY) || "null");
      if (p && Number.isInteger(p.gen)) {
        var c1 = readGen(p.gen);
        if (c1 && validate(c1) && assetKeysExist(c1) && assetsPresent(c1, p.gen)) {
          return { config: c1, source: "active", gen: p.gen };
        }
      }
    } catch (e) { /* 指针坏了继续 */ }

    /* 2. 扫描最大合法 gen */
    var gens = genList();
    for (var i = 0; i < gens.length; i++) {
      var g = gens[i];
      var c2 = readGen(g);
      if (c2 && validate(c2) && assetKeysExist(c2) && assetsPresent(c2, g)) {
        return { config: c2, source: "scan", gen: g };
      }
    }

    /* 3. 内置 */
    var b = bundled();
    if (b && validate(b)) return { config: b, source: "bundled" };
    /* 最后一道：连内置都坏了也不能白屏 */
    return {
      config: {
        schemaVersion: 1, configVersion: 1, updatedAt: "",
        features: { weather: true, reminders: true, search: true, agentMode: true, voiceTts: true, lifeLine: true, killSwitch: false },
        appearance: { background: "warm", expression: "expr.calm", iconPack: "pack.default" },
        copy: { inputPlaceholder: "说点什么…", emptyState: "我在。" },
        quickReplies: { enabled: true, max: 3, items: [] },
        model: { tier: "standard", temperature: 1.25, promptVersion: "v1.0.0" },
        notify: { dailyMax: 2, quietStart: "23:00", quietEnd: "08:00" }
      },
      source: "bundled"
    };
  }

  /* ---------------- 原子提交（§4.2） ---------------- */
  function commit(next) {
    var gen = next.configVersion;
    var tmpKey = GEN_PREFIX + gen + ".tmp";
    try {
      /* 5. 资源先落地（本项目无 onDemand 二进制，只有键校验；保留流程位置） */
      /* 7. 写 tmp */
      localStorage.setItem(tmpKey, JSON.stringify(next));
      /* 8. tmp → final（先删旧的同名，再写正式 key） */
      localStorage.removeItem(GEN_PREFIX + gen);
      localStorage.setItem(GEN_PREFIX + gen, localStorage.getItem(tmpKey) || "");
      localStorage.removeItem(tmpKey);
      /* 9. 原子写指针 */
      localStorage.setItem(PTR_KEY + ".tmp", JSON.stringify({ gen: gen }));
      localStorage.setItem(PTR_KEY, localStorage.getItem(PTR_KEY + ".tmp") || "");
      localStorage.removeItem(PTR_KEY + ".tmp");
      /* 10. 清理超过 2 代 */
      cleanupOldGens(gen);
      return true;
    } catch (e) {
      try { localStorage.removeItem(tmpKey); } catch (e2) { /* ignore */ }
      return false;
    }
  }

  function cleanupOldGens(keep) {
    var gens = genList().filter(function (g) { return g !== keep; });
    /* 当前在用的也算一代：总共留 MAX_GENS 个 */
    var ptr = null;
    try { ptr = JSON.parse(localStorage.getItem(PTR_KEY) || "null"); } catch (e) { ptr = null; }
    var activeGen = ptr && ptr.gen;
    var allow = [keep];
    if (activeGen && allow.indexOf(activeGen) === -1) allow.push(activeGen);
    gens.forEach(function (g) {
      if (allow.indexOf(g) === -1 && allow.length < MAX_GENS) allow.push(g);
    });
    genList().forEach(function (g) {
      if (allow.indexOf(g) === -1) {
        try { localStorage.removeItem(GEN_PREFIX + g); } catch (e) { /* ignore */ }
      }
    });
  }

  /* ---------------- 拉取（§4.1 1~4） ---------------- */
  function acceptIfValid(next, current) {
    if (!validate(next)) return { ok: false, reason: "invalid" };
    if (next.configVersion <= current.configVersion) return { ok: false, reason: "not_newer" };
    if (!assetKeysExist(next)) return { ok: false, reason: "asset_key" };
    if (!commit(next)) return { ok: false, reason: "commit_failed" };
    return { ok: true, config: next };
  }

  /* ---------------- 恢复默认（§8.1） ---------------- */
  function resetToBundled() {
    try {
      localStorage.removeItem(PTR_KEY);
      genList().forEach(function (g) { localStorage.removeItem(GEN_PREFIX + g); });
    } catch (e) { /* ignore */ }
    return loadActive();
  }

  function status() {
    var r = loadActive();
    var gens = genList();
    return {
      version: r.config.configVersion,
      source: r.source,
      gen: r.gen || null,
      gens: gens.length,
      assetsTotal: Object.keys(ASSET_MAP).length
    };
  }

  return {
    PTR_KEY: PTR_KEY,
    GEN_PREFIX: GEN_PREFIX,
    MAX_GENS: MAX_GENS,
    ASSET_MAP: ASSET_MAP,
    bundled: bundled,
    validate: validate,
    assetKeysExist: assetKeysExist,
    assetsPresent: assetsPresent,
    loadActive: loadActive,
    commit: commit,
    cleanupOldGens: cleanupOldGens,
    acceptIfValid: acceptIfValid,
    resetToBundled: resetToBundled,
    genList: genList,
    status: status
  };
});
