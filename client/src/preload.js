import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  onStartVoiceInput: (callback) => {
    ipcRenderer.removeAllListeners("start-voice-input");
    ipcRenderer.on("start-voice-input", (_event, payload) => callback(payload));
  },
  onPlayDing: (callback) => {
    ipcRenderer.removeAllListeners("play-ding");
    ipcRenderer.on("play-ding", () => callback());
  },
  beep: () => ipcRenderer.invoke("app-shell-beep"),
  openExternal: (link) => ipcRenderer.invoke("open-external", link),
});
