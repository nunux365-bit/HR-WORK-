/**
 * HR Flow — Electron Native Desktop Application Main Process (electron/main.js)
 * Wraps HR Flow in a native Adobe-style chromeless desktop application window.
 */

const { app, BrowserWindow, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow = null;
let backendProcess = null;
let tray = null;

const PORT = 5000;
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;
const APP_URL = `http://127.0.0.1:${PORT}/login.html`;

function checkBackendHealth(callback) {
  http.get(HEALTH_URL, (res) => {
    if (res.statusCode >= 200 && res.statusCode < 500) {
      callback(true);
    } else {
      callback(false);
    }
  }).on('error', () => {
    callback(false);
  });
}

function startBackend() {
  const rootDir = path.resolve(__dirname, '..');
  let pyBin = 'python3';
  if (process.platform === 'win32') {
    pyBin = path.join(rootDir, '.venv', 'Scripts', 'python.exe');
  } else {
    pyBin = path.join(rootDir, '.venv', 'bin', 'python3');
  }

  const serverScript = path.join(rootDir, 'backend', 'server.py');

  backendProcess = spawn(pyBin, [serverScript], {
    cwd: rootDir,
    detached: false,
    stdio: 'ignore'
  });

  backendProcess.on('error', (err) => {
    console.error('Failed to start python backend:', err);
  });
}

function createWindow() {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, '..', 'frontend', 'img', 'hrflow.ico')
    : path.join(__dirname, '..', 'frontend', 'img', 'nexus-logo-512.png');

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 650,
    title: 'HR Flow — Autonomous Workforce Operations',
    icon: iconPath,
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load when backend is ready
  function waitForBackendAndLoad(retries = 30) {
    checkBackendHealth((isOnline) => {
      if (isOnline) {
        mainWindow.loadURL(APP_URL);
        mainWindow.once('ready-to-show', () => {
          mainWindow.show();
        });
      } else if (retries > 0) {
        setTimeout(() => waitForBackendAndLoad(retries - 1), 400);
      } else {
        mainWindow.loadURL(APP_URL);
        mainWindow.show();
      }
    });
  }

  waitForBackendAndLoad();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Check if backend is already running (e.g. dev mode)
  checkBackendHealth((isRunning) => {
    if (!isRunning) {
      startBackend();
    }
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    try {
      backendProcess.kill();
    } catch (_) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

