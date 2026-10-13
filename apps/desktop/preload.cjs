// Minimal, explicit bridge for the setup window. Web pages get no Node access.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mystreamDesktop', {
  getSettings: () => ipcRenderer.invoke('mystream:get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('mystream:save-settings', s),
  openSetup: () => ipcRenderer.invoke('mystream:open-setup'),
  resetAdmin: (password) => ipcRenderer.invoke('mystream:reset-admin', password),
});
