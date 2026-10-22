/* ============================================================
   records.js —— 聊天记录的唯一数据层（软删除 + 统一出口）

   ★ 三条铁律
     ① 所有读路径都必须走这里（query* / raw* 成对提供），
        禁止各处自己 `S.get("aura_msgs_"+sid)` 再手动过滤 —— 那一定漏。
     ② 删除 = 把 deletedAt 写成时间戳（软删除），30 天后才物理清。
     ③ 删除**绝不**碰记忆、情绪、忍耐值 —— 那是全局的，与会话无关。

   字段
     messages: { id, role, content, ts, bubbleCount, deletedAt: number|null }
     sessions: { id, title, created, updated, pinned, archived, deletedAt: number|null }

   两种存储的关系（沿用本轮定案）
     localStorage = 热缓存（同步读写，界面用）
     IndexedDB   = 持久层（idb.js 镜像 + deletedAt 索引）
     二者同源同构，软删除只改字段，不挪数据。
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraRecords = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SESSION_KEY = "aura_sessions";          /* features.js 一直写这个键 —— 以它为准 */
  var SESSION_KEY_LEGACY = "aura_sessions_v1"; /* 早期版本/测试数据可能落在这里 */
  var MSG_PREFIX = "aura_msgs_";
  var KEEP_DAYS = 30;
  var MSG_PREFIX = "aura_msgs_";
  var KEEP_DAYS = 30;

  function S() {
    return (typeof window !== "undefined" && window.Aura && window.Aura.store) ? window.Aura.store : null;
  }
  function now() { return Date.now(); }
  function alive(x) { return x && !x.deletedAt; }

  /* ---------------- 底层读写（**只给本模块用**） ---------------- */
  function readSessionsRaw() {
    var s = S();
    if (!s) return [];
    var arr = s.get(SESSION_KEY, null);
    if (!Array.isArray(arr) || !arr.length) {
      /* 一次性兼容：旧键里有数据就搬过来（搬完不删旧键，留作备份） */
      var legacy = s.get(SESSION_KEY_LEGACY, null);
      if (Array.isArray(legacy) && legacy.length) {
        s.set(SESSION_KEY, legacy);
        arr = legacy;
      }
    }
    return Array.isArray(arr) ? arr : [];
  }
  function writeSessionsRaw(arr) {
    var s = S();
    if (s) s.set(SESSION_KEY, arr);
    return arr;
  }
  function readMsgsRaw(sid) {
    var s = S();
    var arr = s ? (s.get(MSG_PREFIX + sid, []) || []) : [];
    return Array.isArray(arr) ? arr : [];
  }
  function writeMsgsRaw(sid, arr) {
    var s = S();
    if (s) s.set(MSG_PREFIX + sid, arr);
    return arr;
  }

  /* ---------------- 统一读出口（界面只准用这些） ---------------- */
  function sessions(opts) {
    opts = opts || {};
    var list = readSessionsRaw().filter(alive);
    if (opts.archived === true) list = list.filter(function (s) { return !!s.archived; });
    if (opts.archived === false) list = list.filter(function (s) { return !s.archived; });
    return list.sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      return (b.updated || 0) - (a.updated || 0);
    });
  }

  function messages(sid) {
    return readMsgsRaw(sid).filter(alive);
  }

  function lastMessage(sid) {
    var arr = messages(sid);
    return arr.length ? arr[arr.length - 1] : null;
  }

  function messageCount(sid) {
    return messages(sid).length;
  }

  /* 所有会话的消息总数（只算未删除的） */
  function totalMessages() {
    var n = 0;
    sessions({}).forEach(function (s) { n += messageCount(s.id); });
    return n;
  }

  /* 估算占用字节（localStorage 的 UTF-16 字符数 × 2） */
  function estimatedBytes() {
    var bytes = 0;
    try {
      sessions({}).forEach(function (s) {
        bytes += (JSON.stringify(messages(s.id)) || "").length * 2;
      });
    } catch (e) { /* ignore */ }
    return bytes;
  }

  function stats() {
    var list = sessions({});
    var msgs = totalMessages();
    return {
      sessions: list.length,
      messages: msgs,
      bytes: estimatedBytes(),
      mb: (estimateMb(estimatedBytes()))
    };
  }
  function estimateMb(bytes) { return Math.round(bytes / 1048576 * 10) / 10; }

  /* ---------------- 写（统一出口） ----------------
     保存时**保留墓碑**：调用方传进来的是"活着的消息"，
     磁盘上已软删除的那些不会被这里顺手抹掉。 */
  function saveMessages(sid, arr) {
    var incoming = Array.isArray(arr) ? arr : [];
    var seen = {};
    incoming.forEach(function (m) { if (m && m.id) seen[m.id] = true; });

    var raw = readMsgsRaw(sid);
    var tombstones = raw.filter(function (m) { return m && m.deletedAt && !seen[m.id]; });
    var clean = incoming.map(function (m) {
      if (!m) return m;
      return Object.assign({}, m, { deletedAt: m.deletedAt || null, sessionId: sid });
    });
    return writeMsgsRaw(sid, clean.concat(tombstones));
  }

  function touchSession(sid) {
    var list = readSessionsRaw();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== sid) continue;
      list[i].updated = now();
      var lm = lastMessage(sid);
      if (lm && lm.content) list[i].preview = String(lm.content).slice(0, 40);
      break;
    }
    return writeSessionsRaw(list);
  }

  function createSession(title) {
    var list = readSessionsRaw();
    var id = "s" + now().toString(36) + Math.random().toString(36).slice(2, 6);
    list.unshift({
      id: id, title: title || "新的对话",
      created: now(), updated: now(), pinned: false, archived: false, deletedAt: null
    });
    writeSessionsRaw(list);
    return id;
  }

  /* ---------------- 软删除 ---------------- */
  function softDeleteMessage(sid, msgId) {
    var raw = readMsgsRaw(sid);
    var hit = null;
    for (var i = 0; i < raw.length; i++) {
      if (raw[i].id === msgId && !raw[i].deletedAt) { raw[i].deletedAt = now(); hit = raw[i]; break; }
    }
    if (!hit) return null;
    writeMsgsRaw(sid, raw);
    touchSession(sid);
    return hit;
  }

  /* 会话软删除：会话本身 + 它下面所有消息一起打删除标记
     （选择：一起删。理由：恢复时要"条数与删除前完全一致"，
       只删会话不删消息会在恢复后冒出别的消息，或让统计对不上） */
  function softDeleteSession(sid) {
    var list = readSessionsRaw();
    var hit = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === sid && !list[i].deletedAt) { list[i].deletedAt = now(); hit = list[i]; break; }
    }
    if (!hit) return null;
    writeSessionsRaw(list);

    var raw = readMsgsRaw(sid);
    var t = now();
    var n = 0;
    raw.forEach(function (m) { if (!m.deletedAt) { m.deletedAt = t; n += 1; } });
    writeMsgsRaw(sid, raw);
    return { session: hit, messages: n, at: t };
  }

  function restoreMessage(sid, msgId) {
    var raw = readMsgsRaw(sid);
    var hit = null;
    for (var i = 0; i < raw.length; i++) {
      if (raw[i].id === msgId) { raw[i].deletedAt = null; hit = raw[i]; break; }
    }
    if (hit) { writeMsgsRaw(sid, raw); touchSession(sid); }
    return hit;
  }

  function restoreSession(sid) {
    var list = readSessionsRaw();
    var hit = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === sid) { list[i].deletedAt = null; hit = list[i]; break; }
    }
    if (!hit) return null;
    writeSessionsRaw(list);

    var raw = readMsgsRaw(sid);
    raw.forEach(function (m) { m.deletedAt = null; });
    writeMsgsRaw(sid, raw);
    touchSession(sid);
    return hit;
  }

  /* ---------------- 物理清理（启动时异步跑一次） ---------------- */
  function purge(opts) {
    opts = opts || {};
    var days = typeof opts.days === "number" ? opts.days : KEEP_DAYS;
    var cutoff = (opts.now || now()) - days * 86400000;
    var before = { sessions: 0, messages: 0 };

    var list = readSessionsRaw();
    var kept = [];
    list.forEach(function (s) {
      if (s && s.deletedAt && s.deletedAt < cutoff) {
        before.sessions += 1;
        try {
          var raw = readMsgsRaw(s.id);
          before.messages += raw.length;
          var st = S();
          if (st) st.del(MSG_PREFIX + s.id);
        } catch (e) { /* ignore */ }
      } else {
        kept.push(s);
      }
    });
    if (kept.length !== list.length) writeSessionsRaw(kept);

    /* 会话还在，但其中过期的单条消息也清掉 */
    kept.forEach(function (s) {
      var raw = readMsgsRaw(s.id);
      var left = raw.filter(function (m) {
        var dead = m && m.deletedAt && m.deletedAt < cutoff;
        if (dead) before.messages += 1;
        return !dead;
      });
      if (left.length !== raw.length) writeMsgsRaw(s.id, left);
    });

    return before;
  }

  /* 彻底删除：物理删掉会话 + 它的消息（不进回收站，不可恢复） */
  function hardDeleteSession(sid) {
    var list = readSessionsRaw();
    var kept = list.filter(function (s) { return s.id !== sid; });
    if (kept.length !== list.length) writeSessionsRaw(kept);
    try {
      var st = S();
      if (st) st.del(MSG_PREFIX + sid);
    } catch (e) { /* 删不掉就留着，至少会话已经不可见了 */ }
    return kept.length !== list.length;
  }

  /* ---------------- 回收站视图（**只有名字与时间**） ----------------
     刻意不返回任何 content / preview —— 能预览就会有人反复回去看。 */
  function trash() {
    var out = [];
    readSessionsRaw().forEach(function (s) {
      if (s && s.deletedAt) out.push({ kind: "session", id: s.id, title: s.title || "未命名", deletedAt: s.deletedAt });
    });
    return out.sort(function (a, b) { return b.deletedAt - a.deletedAt; });
  }

  return {
    KEEP_DAYS: KEEP_DAYS,
    SESSION_KEY: SESSION_KEY,
    SESSION_KEY_LEGACY: SESSION_KEY_LEGACY,
    MSG_PREFIX: MSG_PREFIX,

    /* 读 */
    sessions: sessions,
    messages: messages,
    lastMessage: lastMessage,
    messageCount: messageCount,
    totalMessages: totalMessages,
    stats: stats,
    trash: trash,

    /* 写 */
    saveMessages: saveMessages,
    createSession: createSession,
    touchSession: touchSession,
    renameSession: function (sid, title) {
      var list = readSessionsRaw();
      list.forEach(function (s) { if (s.id === sid) s.title = String(title || "新的对话").slice(0, 24); });
      return writeSessionsRaw(list);
    },
    setFlag: function (sid, key, val) {
      var list = readSessionsRaw();
      list.forEach(function (s) { if (s.id === sid) s[key] = val; });
      return writeSessionsRaw(list);
    },

    /* 删除 / 恢复 / 清理 */
    softDeleteMessage: softDeleteMessage,
    softDeleteSession: softDeleteSession,
    hardDeleteSession: hardDeleteSession,
    restoreMessage: restoreMessage,
    restoreSession: restoreSession,
    purge: purge,

    /* 给迁移/调试用：拿到含墓碑的原始数组 */
    rawSessions: readSessionsRaw,
    rawMessages: readMsgsRaw
  };
});
