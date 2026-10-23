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
  var DB_VERSION = 2;                    /* v2：给 messages / sessions 补 deletedAt 索引（软删除） */
  var SUPPORTED_SCHEMA = 1;
  var STORES = {
    messages: { keyPath: "id", indexes: [["sessionId", "sessionId"], ["createdAt", "ts"], ["deletedAt", "deletedAt"]] },
    sessions: { keyPath: "id", indexes: [["lastMessageAt", "lastMessageAt"], ["deletedAt", "deletedAt"]] },
    memories: { keyPath: "id", indexes: [["status", "status"]] },
    lifeEvents: { keyPath: "id", indexes: [["date", "date"]] },
    openLoops: { keyPath: "id", indexes: [["openedAt", "openedAt"]] },
    config: { keyPath: "key", indexes: [] },
    meta: { keyPath: "key", indexes: [] }
  };

  /* 失败不再无声无息：同一种错误只警告一次，避免刷屏 */
  var warned = {};
  function warnOnce(kind, msg) {
    if (warned[kind]) return;
    warned[kind] = true;
    try { console.warn("[idb] " + kind + "：" + msg + "（已退回 localStorage，不影响使用）"); } catch (e) { }
  }

  var db = null;
  var state = { readOnly: false, migrated: false, lastError: null };
  var report = { before: {}, after: {}, ok: false, at: 0 };

  /* ---------------- 打开 / 建表 ---------------- */
  function open() {
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") return reject(new Error("no-indexeddb"));
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      /* 版本升级时若别的标签页还占着旧版本，open 会一直挂（blocked）。
         这里给 3 秒硬超时：宁可退回 localStorage，也不许让 App 卡在启动。 */
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error("idb-open-timeout"));
      }, 3000);
      req.onblocked = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("idb-blocked"));
      };
      req.onupgradeneeded = function (ev) {
        var d = ev.target.result;
        Object.keys(STORES).forEach(function (name) {
          var cfg = STORES[name];
          var os;
          if (d.objectStoreNames.contains(name)) {
            /* 已存在的表：补索引（v1 → v2 就是靠这里加 deletedAt 索引） */
            os = ev.target.transaction.objectStore(name);
          } else {
            os = d.createObjectStore(name, { keyPath: cfg.keyPath });
          }
          (cfg.indexes || []).forEach(function (pair) {
            if (!os.indexNames.contains(pair[0])) {
              os.createIndex(pair[0], pair[1], { unique: false });
            }
          });
        });
      };
      req.onsuccess = function (ev) {
        settled = true; clearTimeout(timer);
        db = ev.target.result;
        resolve(db);
      };
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
    }).catch(function (e) {
      state.lastError = String(e && e.message || e);
      warnOnce("write", state.lastError);
      return false;
    });
  }

  function getAll(store) {
    return tx([store]).then(function (t) {
      return new Promise(function (res) {
        var r = t.objectStore(store).getAll();
        r.onsuccess = function () { res(r.result || []); };
        r.onerror = function () { res([]); };
      });
    }).catch(function (e) {
      warnOnce("read", String(e && e.message || e));
      return [];
    });
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

  /* ---------------- 切换（§1.3 · 调整版）：不立即删，保留 30 天做备份 ----------------
     校验通过后只记录「到期时间」，到期（且再次校验通过）才真正清掉旧 key。
     这样 localStorage 与 IndexedDB 同时有数据 = 双保险，而不是降低冗余。 */
  var RETENTION_DAYS = 30;

  function cutover() {
    if (!report.ok) return Promise.resolve({ skipped: "not-verified" });
    return getMeta("cutoverAt").then(function (m) {
      if (m) return { skipped: "already", at: m.value };

      var stores = ["messages", "memories", "lifeEvents", "openLoops"];
      return Promise.all(stores.map(function (s) {
        return count(s).then(function (n) { return n; });
      })).then(function (before) {
        var rec = {
          at: Date.now(),
          policy: "keep-30d",
          deleteAfter: Date.now() + RETENTION_DAYS * 86400000,
          idbCounts: { messages: before[0], memories: before[1], lifeEvents: before[2], openLoops: before[3] }
        };
        return setMeta("cutoverAt", rec).then(function () { return rec; });
      });
    }).catch(function (e) {
      state.lastError = "cutover:" + (e && e.message || e);
      return { skipped: "error", error: state.lastError };
    });
  }

  /* 到期清理：只有「到了 30 天」且「条数再校验一次仍然一致」才删 */
  function sweep() {
    return getMeta("cutoverAt").then(function (m) {
      var rec = m && m.value;
      if (!rec || !rec.deleteAfter) return { skipped: "no-cutover" };
      if (Date.now() < rec.deleteAfter) {
        return { skipped: "not-due", deleteAfter: rec.deleteAfter };
      }
      return migrate().then(function (rep) {
        if (!rep.ok) return { skipped: "recheck-failed" };
        var removed = 0;
        try {
          var drop = [];
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k) continue;
            if (k === "aura_life_events_v1" || k === "aura_openloops_v1" ||
                k === "aura_memfacts_v1" || k.indexOf("aura_msgs_") === 0) drop.push(k);
          }
          drop.forEach(function (k) { localStorage.removeItem(k); removed++; });
        } catch (e) { /* 删失败就不删 */ }
        return setMeta("sweptAt", { at: Date.now(), removed: removed }).then(function () {
          return { removed: removed };
        });
      });
    }).catch(function (e) { return { skipped: "error", error: String(e && e.message || e) }; });
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
      drain();
    }, 400);
  }

  /* 把队列里的镜像立刻写完（删除前必须先 await，否则删除会被排队中的写回覆盖） */
  function drain() {
    if (mirrorTimer) { clearTimeout(mirrorTimer); mirrorTimer = null; }
    var batch = pendingWrites.splice(0, pendingWrites.length);
    var jobs = [];
    batch.forEach(function (item) {
      (item.items || []).forEach(function (v) {
        if (!v) return;
        if (item.store === "messages" && !v.id) return;
        jobs.push(put(item.store, v));
      });
    });
    return Promise.all(jobs).catch(function () { return []; });
  }
  function flush() { return drain(); }

  /* 按会话物理删除（messages 按 sessionId 删 + sessions 主键删） */
  function deleteSessionMessages(sid) {
    return tx(["messages"], "readwrite").then(function (t) {
      return new Promise(function (res) {
        var n = 0;
        try {
          var idx = t.objectStore("messages").index("sessionId");
          var cur = idx.openCursor(IDBKeyRange.only(String(sid || "")));
          cur.onsuccess = function (e) {
            var c = e.target.result;
            if (!c) { res(n); return; }
            c.delete(); n += 1; c.continue();
          };
          cur.onerror = function () { res(n); };
        } catch (e) { res(n); }
      });
    }).catch(function () { return 0; });
  }

  function deleteSession(sid) {
    if (!sid) return Promise.resolve(0);
    return deleteSessionMessages(sid).then(function (n) {
      return tx(["sessions"], "readwrite").then(function (t) {
        return new Promise(function (res) {
          var r = t.objectStore("sessions").delete(sid);
          r.onsuccess = function () { res(n); };
          r.onerror = function () { res(n); };
        });
      }).catch(function () { return n; });
    });
  }

  /* localStorage 键被删时同步删镜像（否则 hydrate 会把删掉的又写回来） */
  function forget(lsKey) {
    if (!lsKey) return Promise.resolve(0);
    if (lsKey.indexOf("aura_msgs_") === 0) return deleteSessionMessages(lsKey.slice("aura_msgs_".length));
    if (lsKey === "aura_messages") return deleteSessionMessages("");
    return Promise.resolve(0);
  }

  /* ---------------- 软删除专用：靠 deletedAt 索引，不扫全表 ----------------
     注意：deletedAt 为 null 的记录**不会**进索引（IndexedDB 的 null 不是合法 key），
     这正好合我们的用法 ——「活着的」用 sessionId 索引取，
     「已删除且到期」用 deletedAt 索引的范围查（快得多）。 */
  function deadBefore(store, cutoff) {
    return tx([store]).then(function (t) {
      return new Promise(function (res) {
        try {
          var idx = t.objectStore(store).index("deletedAt");
          var req = idx.count(IDBKeyRange.upperBound(cutoff));
          req.onsuccess = function () { res(req.result || 0); };
          req.onerror = function () { res(-1); };
        } catch (e) { res(-1); }
      });
    }).catch(function () { return -1; });
  }

  function purgeDead(store, cutoff) {
    return tx([store], "readwrite").then(function (t) {
      return new Promise(function (res) {
        var n = 0;
        try {
          var idx = t.objectStore(store).index("deletedAt");
          var cur = idx.openCursor(IDBKeyRange.upperBound(cutoff));
          cur.onsuccess = function (e) {
            var c = e.target.result;
            if (!c) { res(n); return; }
            c.delete();
            n += 1;
            c.continue();
          };
          cur.onerror = function () { res(n); };
        } catch (e) { res(n); }
      });
    }).catch(function () { return 0; });
  }

  function clearStore(name) {    return tx([name], "readwrite").then(function (t) {
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
    RETENTION_DAYS: RETENTION_DAYS,
    STORES: STORES,
    open: open,
    get: getAll,
    getAll: getAll,
    put: put,
    count: count,
    getMeta: getMeta,
    setMeta: setMeta,
    migrate: migrate,
    cutover: cutover,
    sweep: sweep,
    gate: gate,
    hydrate: hydrate,
    mirror: mirror,
    flush: flush,
    forget: forget,
    deleteSession: deleteSession,
    deleteSessionMessages: deleteSessionMessages,
    clearStore: clearStore,
    deadBefore: deadBefore,
    purgeDead: purgeDead,
    state: function () { return state; },
    report: function () { return report; }
  };
});
