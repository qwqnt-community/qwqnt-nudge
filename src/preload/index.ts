import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("nudgeDebug", {
  getConfig: () => ipcRenderer.invoke("nudge:get-config"),
  setConfig: (patch: Record<string, unknown>) =>
    ipcRenderer.send("nudge:set-config", patch),
  onConfigChange: (cb: (c: unknown) => void) => {
    ipcRenderer.on("nudge:config-changed", (_e, c) => cb(c));
  },
  sendNudge: (chatType: number, peerUid: string, targetUin: string) =>
    ipcRenderer.invoke("nudge:send", { chatType, peerUid, targetUin }),
});
