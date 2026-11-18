// Lets the Mission Board page talk to the desktop app (only for the Settings page).
// Runs only on our own Google Apps Script pages.
const { contextBridge, ipcRenderer } = require('electron');

function ours() {
  const o = String(self.origin || '');
  const h = String(location.hostname || '');
  return o === 'https://script.google.com' || /\.googleusercontent\.com$/.test(o) ||
    h === 'script.google.com' || /\.googleusercontent\.com$/.test(h);
}

if (ours()) {
  contextBridge.exposeInMainWorld('vswafDesktop', {
    getSettings: () => ipcRenderer.invoke('vswaf:get'),
    setAutoUpdate: (on) => ipcRenderer.invoke('vswaf:set-auto', !!on),
    checkForUpdates: () => ipcRenderer.invoke('vswaf:check')
  });
}
