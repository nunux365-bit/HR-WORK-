/**
 * HR Flow — Electron Preload Bridge
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0',
  sendNotification: (title, body) => {
    new Notification(title, { body, icon: '../frontend/img/nexus-logo-64.png' });
  }
});

