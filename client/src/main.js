import { app, BrowserWindow, globalShortcut, ipcMain, shell } from "electron";
import path from "node:path";
import url from "node:url";

const isDev = process.env.NODE_ENV !== "production";
const HOTKEY_TOGGLE = "Alt+Space";
const HOTKEY_BACKGROUND = "Alt+Shift+Space";

let mainWindow;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: "Desktop Assistant",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexUrl = url.pathToFileURL(
      path.join(__dirname, "../dist/renderer/index.html")
    );
    mainWindow.loadURL(indexUrl.href);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

const registerShortcuts = () => {
  globalShortcut.register(HOTKEY_TOGGLE, () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized() || !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("play-ding");
      mainWindow.webContents.send("start-voice-input", { background: false });
    } else {
      mainWindow.minimize();
    }
  });

  globalShortcut.register(HOTKEY_BACKGROUND, () => {
    if (!mainWindow) return;
    mainWindow.webContents.send("play-ding");
    mainWindow.webContents.send("start-voice-input", { background: true });
  });
};

ipcMain.handle("open-external", (_event, link) => shell.openExternal(link));
ipcMain.handle("app-shell-beep", () => shell.beep());

app.whenReady().then(() => {
  createWindow();
  registerShortcuts();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
