/* desktop/keypreload.js —— 密钥窗口的桥
   只暴露两个方法，页面里拿不到 require / Node。 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__aura", {
  save: function (v) { ipcRenderer.send("key:save", String(v || "")); },
  cancel: function () { ipcRenderer.send("key:cancel"); },
  ready: function () { ipcRenderer.send("key:ready"); }
});
