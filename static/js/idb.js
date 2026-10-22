/* ============================================================
   idb.js —— IndexedDB 存储层（本轮定案）

   为什么换掉 localStorage：5~10MB 上限、系统可能清理、不支持二进制、同步阻塞。
   "她记得我"是核心价值，不能建在那上面。

   设计（不阻塞启动，旧数据一条不丢）：
     ① 启动先用 localStorage 里现成的数据渲染（同步、快）
     ② 后台 migrate()：逐条搬到 IndexedDB，**逐类比对条数**
     ③ 全部一致 → 写 meta.migrated=1；不一致 → 保留旧数据、记 warning、继续用 localStorage
     ④ 之后每次写还是写 localStorage（热缓存），同时 **write-through 到 IDB**（持久层）
     ⑤ hydrate()：localStorage 被系统清了 → 用 IDB 还原回去

   红线：校验通过前不删任何旧数据（本实现**从不删除** localStorage，只做镜像）。
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraDB = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DB_NAME = "aura";
  var DB_VERSION = 1;
  var SUPPORTED_SCHEMA = 1;
  var STORES = {
    messages: { keyPath: "id", indexes: [["sessionId", "sessionId"], ["createdAt", "ts"]] },
    sessions: { keyPath: "id", indexes: [["lastMessageAt", "lastMessageAt"]] },
    memories: { keyPath: "id", indexes: [["status", "status"]] },
    lifeEvents: { keyPath: "id", indexes: [["date", "date"]] },
    openLoops: { keyPath: "id", indexes: [["openedAt", "openedAt"]] },
    config: { keyPath: "key", indexes: [] },
    meta: { keyPath: "key", indexes: [] }
  };

  var db = null;
  var state = { readOnly: false, migrated: false, lastError: null };
  var report = { before: {}, after: {}, ok: false, at: 0 };

  /* ---------------- 打开 / 建表 ---------------- */
  function open() {
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") return reject(new Error("no-indexeddb"));
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (ev) {
        var d = ev.target.result;
        Object.keys(STORES).forEach(function (name) {
          if (d.objectStoreNames.contains(name)) return;
          var cfg = STORES[name];
          var os = d.createObjectStore(name, { keyPath: cfg.keyPath });
          (cfg.indexes || []).forEach(function (pair) {
            os.createIndex(pair[0], pair[1], { unique: false });
          });
        });
      };
      req.onsuccess = function (ev) { db = ev.target.result; resolve(db); };
      req.onerror = function () { reject(req.error || new Error("idb-open-failed")); };
    });
  }

  function tx(stores, mode) {
    return open().then(function (d) { return d.transaction(stores, mode || "readonly"); });
  }

  function put(store, val) {
    return tx([store], "readwrite").then(function (t) {
      return new Promise(function (res, rej) {
        var r = t.objectStore(store).put(val);
        r.onsuccess = function () { res(true); };
        r.onerror = function () { rej(r.error); };
      });
    }).catch(function (e) { state.lastError = String(e && e.message || e); return false; });
  }

  function getAll(store) {
    return tx([store]).then(function (t) {
      return new Promise(function (res) {
        var r = t.objectStore(store).getAll();
        r.onsuccess = function () { res(r.result || []); };
        r.onerror = function () { res([]); };
      });
    }).catch(function () { return []; });
  }

  function count(store) {
    return tx([store]).then(function (t) {
      return new Promise(function (res) {
        var r = t.objectStore(store).count();
        r.onsuccess = function () { res(r.result || 0); };
        r.onerror = function () { res(0); };
      });
    }).catch(function () { return 0; });
  }

  function getMeta(key) {
    return tx(["meta"]).then(function (t) {
      return new Promise(function (res) {
        var r = t.objectStore("meta").get(key);
        r.onsuccess = function () { res(r.result || null); };
        r.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }

  function setMeta(key, value) {
    return put("meta", { key: key, value: value, at: Date.now() });
  }

  /* ---------------- 旧 key ↔ 新 store 的映射 ---------------- */
  function classify(key, raw) {
    var v;
    try { v = JSON.parse(raw); } catch (e) { v = raw; }
    /* 消息：实际 key 是 aura_msgs_<sessionId>（老版是 aura_messages） */
    if ((key.indexOf("aura_msgs_") === 0 || key.indexOf("aura_messages") === 0) && Array.isArray(v)) {
      var sid = key.indexOf("aura_msgs_") === 0 ? key.slice("aura_msgs_".length) : "";
      return { store: "messages", items: v.map(function (m) {
        return {
          id: m.id, sessionId: m.sessionId || sid || "",
          role: m.role, content: m.content, ts: m.ts, bubbleCount: m.bubbleCount || 1
        };
      }) };
    }
    if (key.indexOf("aura_memfacts") === 0 && Array.isArray(v)) return { store: "memories", items: v };
    if (key === "aura_life_events_v1" && Array.isArray(v)) return { store: "lifeEvents", items: v };
    if (key === "aura_openloops_v1" && Array.isArray(v)) return { store: "openLoops", items: v };
    if (key === "aura_cfg_current") return { store: "config", items: [{ key: "current", value: v }] };
    if (key.indexOf("aura_cfg_gen_") === 0) {
      return { store: "config", items: [{ key: key.replace("aura_cfg_gen_", "gen-"), value: v }] };
    }
    if (key === "aura_sessions_v1" && Array.isArray(v)) return { store: "sessions", items: v };
    /* 其余（设置项、开关、标记）统一进 meta */
    return { store: "meta", items: [{ key: key, value: v }] };
  }

  /* ---------------- 迁移（幂等、可重入、先校验后标记） ---------------- */
  function migrate() {
    var expected = {};      /* store → 应有条数 */
    var collected = {};     /* store → 待写记录 */
    var lsKeys = [];

    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf("aura_") !== 0) continue;
        lsKeys.push(k);
        var c = classify(k, localStorage.getItem(k));
        collected[c.store] = (collected[c.store] || []).concat(c.items);
      }
    } catch (e) {
      state.lastError = "ls-read:" + e.message;
    }

    Object.keys(collected).forEach(function (s) {
      expected[s] = collected[s].length;
    });
    report.before = expected;

    /* 逐条写（幂等：put 按 key 覆盖） */
    var writes = [];
    Object.keys(collected).forEach(function (s) {
      collected[s].forEach(function (item) {
        if (!item) return;
        if (s === "messages" && !item.id) return;
        writes.push(put(s, item));
      });
    });

    return Promise.all(writes).then(function () {
      return setMeta("schemaVersion", SUPPORTED_SCHEMA);
    }).then(function () {
      /* 逐类比对条数 */
      var stores = Object.keys(expected);
      return Promise.all(stores.map(function (s) {
        return count(s).then(function (n) {
          report.after[s] = n;
          return { s: s, want: expected[s], got: n };
        });
      })).then(function (rows) {
        var bad = rows.filter(function (r) { return r.got < r.want; });
        report.ok = bad.length === 0;
        report.at = Date.now();
        report.lsKeys = lsKeys.length;
        if (report.ok) {
          state.migrated = true;
          return setMeta("migrated", { at: Date.now(), counts: report.after });
        }
        /* 不一致：保留旧数据、记 warning、继续用 localStorage */
        console.warn("[idb] 迁移条数不一致，继续用 localStorage", rows);
        return setMeta("migrate_failed", { at: Date.now(), rows: rows });
      });
    }).then(function () {
      return report;
    }).catch(function (e) {
      state.lastError = "migrate:" + (e && e.message || e);
      return report;
    });
  }

  /* ---------------- 启动时的版本闸门 ---------------- */
  function gate() {
    return getMeta("schemaVersion").then(function (m) {
      var v = m && typeof m.value === "number" ? m.value : 0;
      if (v > SUPPORTED_SCHEMA) {
        /* 数据比代码新 → 只读模式，不写入，避免写坏 */
        state.readOnly = true;
        console.warn("[idb] schemaVersion " + v + " > 支持上限 " + SUPPORTED_SCHEMA + "：进入只读模式");
      }
      return { version: v, readOnly: state.readOnly };
    }).catch(function () { return { version: 0, readOnly: false }; });
  }

  /* ---------------- hydrate：localStorage 被清时从 IDB 还原 ---------------- */
  function hydrate() {
    return Promise.all([
      getAll("memories"), getAll("lifeEvents"), getAll("openLoops"), getAll("messages"), getAll("config")
    ]).then(function (r) {
      var restored = {};
      var mem = r[0], life = r[1], loops = r[2], msgs = r[3], cfgs = r[4];

      function need(lsKey, list) {
        try { return !localStorage.getItem(lsKey) && list && list.length; } catch (e) { return false; }
      }
      try {
        if (need("aura_memfacts_v1", mem)) {
          localStorage.setItem("aura_memfacts_v1", JSON.stringify(mem));
          restored.memories = mem.length;
        }
        if (need("aura_life_events_v1", life)) {
          localStorage.setItem("aura_life_events_v1", JSON.stringify(life));
          restored.lifeEvents = life.length;
        }
        if (need("aura_openloops_v1", loops)) {
          localStorage.setItem("aura_openloops_v1", JSON.stringify(loops));
          restored.openLoops = loops.length;
        }
        if (msgs && msgs.length) {
          /* 按会话还原回 aura_msgs_<sessionId> */
          var bySid = {};
          msgs.forEach(function (m) { (bySid[m.sessionId || "default"] = bySid[m.sessionId || "default"] || []).push(m); });
          Object.keys(bySid).forEach(function (sid) {
            var k = "aura_msgs_" + sid;
            try {
              if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(bySid[sid]));
            } catch (e) { }
          });
          restored.messages = msgs.length;
        }
        (cfgs || []).forEach(function (c) {
          var k = c.key === "current" ? "aura_cfg_current" : "aura_cfg_gen_" + String(c.key).replace("gen-", "");
          try { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(c.value)); } catch (e) { }
        });
      } catch (e) { /* ignore */ }
      return restored;
    }).catch(function () { return {}; });
  }

  /* ---------------- write-through：每次写 localStorage 顺手镜像 ---------------- */
  var pendingWrites = [];
  function mirror(lsKey, rawValue) {
    if (state.readOnly) return;                    /* 只读模式绝不写 */
    if (!lsKey || lsKey.indexOf("aura_") !== 0) return;
    var c;
    try { c = classify(lsKey, rawValue); } catch (e) { return; }
    queueMirror(c);
  }

  var mirrorTimer = null;
  function queueMirror(c) {
    pendingWrites.push(c);
    if (mirrorTimer) return;
    mirrorTimer = setTimeout(function () {
      mirrorTimer = null;
      var batch = pendingWrites.splice(0, pendingWrites.length);
      batch.forEach(function (item) {
        (item.items || []).forEach(function (v) {
          if (!v) return;
          if (item.store === "messages" && !v.id) return;
          put(item.store, v);
        });
      });
    }, 400);
  }

  function clearStore(name) {
    return tx([name], "readwrite").then(function (t) {
      return new Promise(function (res) {
        var r = t.objectStore(name).clear();
        r.onsuccess = function () { res(true); };
        r.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
  }

  return {
    DB_NAME: DB_NAME,
    SUPPORTED_SCHEMA: SUPPORTED_SCHEMA,
    STORES: STORES,
    open: open,
    get: getAll,
    getAll: getAll,
    put: put,
    count: count,
    getMeta: getMeta,
    setMeta: setMeta,
    migrate: migrate,
    gate: gate,
    hydrate: hydrate,
    mirror: mirror,
    clearStore: clearStore,
    state: function () { return state; },
    report: function () { return report; }
  };
});
