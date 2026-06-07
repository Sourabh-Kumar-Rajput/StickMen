// Electron desktop wrapper — the simplest "double-click to run" desktop build.
// Loads the same web game (../index.html) in a Chromium window. No service
// worker needed; assets load directly. Run with:  cd desktop && npm i && npm start
const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: "#0b0e14",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true }
  });
  win.loadFile(path.join(__dirname, "..", "index.html"));
}

app.whenReady().then(function () {
  createWindow();
  app.on("activate", function () { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", function () { if (process.platform !== "darwin") app.quit(); });
