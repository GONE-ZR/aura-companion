/* ============================================================
   desktop/preload.js —— 安全桥
   渲染进程只能通过这里接触密钥相关能力；不开 nodeIntegration。
   ============================================================ */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("auraDesktop", {
  isDesktop: true,
  hasKey: () => ipcRenderer.invoke("aura:hasKey"),
  setKey: (v) => ipcRenderer.invoke("aura:setKey", v),
  platform: process.platform
});
