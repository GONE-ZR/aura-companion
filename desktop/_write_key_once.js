/* 用 Electron 的 safeStorage 把密钥加密写进 userData/config.json
   这样即使是旧版 exe，启动时也读得到密钥、不再弹那个卡住的窗口。
   用法：npx electron desktop/_write_key_once.js
*/
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

/* 必须和打包后的 app 同名，否则 userData 会落到 %APPDATA%\Electron */
app.setName("aura-companion");
app.setPath("userData", path.join(process.env.APPDATA, "aura-companion"));

const PROJECT = path.resolve(__dirname, "..");

function keyFromDotEnv() {
  try {
    const txt = fs.readFileSync(path.join(PROJECT, ".env"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*DEEPSEEK_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  } catch (e) { }
  return "";
}

app.whenReady().then(() => {
  const key = keyFromDotEnv();
  if (!key) {
    console.log("NO_KEY");
    app.quit();
    return;
  }
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "config.json");
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { cfg = {}; }

  if (safeStorage.isEncryptionAvailable()) {
    cfg.encKey = safeStorage.encryptString(key).toString("base64");
    delete cfg.plainKey;
    fs.writeFileSync(p, JSON.stringify(cfg), "utf8");
    console.log("OK encKey len=" + cfg.encKey.length + " file=" + p);
  } else {
    cfg.plainKey = key;
    fs.writeFileSync(p, JSON.stringify(cfg), "utf8");
    console.log("OK plainKey（系统加密不可用）+ file=" + p);
  }
  app.quit();
});
