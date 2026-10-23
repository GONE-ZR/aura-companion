/* 静态核查：把每条断言的 checks 落到具体文件:行号
   用法: node tools/audit/run_static.js [项目根]  → 输出 JSON 到 stdout
*/
const fs = require("fs");
const path = require("path");
const assert = require("./assertions");

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, "../..");

function expand(f) {
  if (!f.includes("*")) return [f];
  const dir = path.posix.dirname(f);
  const re = new RegExp("^" + path.posix.basename(f).replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
  let out = [];
  try {
    out = fs.readdirSync(path.join(ROOT, dir)).filter((n) => re.test(n)).map((n) => path.posix.join(dir, n));
  } catch (e) { }
  return out;
}

function read(rel) {
  const p = path.join(ROOT, rel);
  try { return fs.readFileSync(p, "utf8"); } catch (e) { return null; }
}

function lineOf(text, re) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return 0;
}

const results = [];
for (const a of assert) {
  const evidence = [];
  let failed = null;
  for (const c of a.checks || []) {
    const files = expand(c.f);
    if (!files.length) { failed = { why: "文件不存在: " + c.f }; break; }
    const re = new RegExp(c.re, "m");
    let hits = 0, first = null;
    for (const f of files) {
      const txt = read(f);
      if (txt == null) continue;
      const n = (txt.match(new RegExp(c.re, "gm")) || []).length;
      if (n > 0) { hits += n; if (!first) first = f + ":" + lineOf(txt, re); }
    }
    if (c.absent) {
      if (hits > 0) { failed = { why: "不应出现但命中 " + hits + " 次 @ " + first }; break; }
      evidence.push({ f: c.f, hits: 0, at: "(无)", expect: "absent" });
    } else {
      if (hits === 0) { failed = { why: "未命中: " + c.f + " /" + c.re + "/" }; break; }
      evidence.push({ f: c.f, hits, at: first, expect: "present" });
    }
  }
  results.push({
    id: a.id, group: a.g, text: a.t, sev: a.sev,
    static: failed ? "FAIL" : "PASS",
    staticWhy: failed ? failed.why : null,
    rt: a.rt || null,
    evidence
  });
}

const summary = {
  root: ROOT,
  total: results.length,
  pass: results.filter((r) => r.static === "PASS").length,
  fail: results.filter((r) => r.static === "FAIL").length,
  withRuntime: results.filter((r) => r.rt).length,
  results
};
process.stdout.write(JSON.stringify(summary, null, 1));
