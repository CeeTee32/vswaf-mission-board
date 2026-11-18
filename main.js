// vSWAF Mission Board – desktop app.
// Opens the vSWAF web app (Google Apps Script) in its own window.
// All data lives in the shared Google Sheet, so every pilot sees the same board.

const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

// ---- Settings saved on this computer (just "automatic updates on/off") ----
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return Object.assign({ autoUpdate: true }, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); }
  catch (e) { return { autoUpdate: true }; }
}
function saveSettings(s) { try { fs.writeFileSync(settingsFile(), JSON.stringify(s)); } catch (e) {} }
let settings;
const config = require('./config.json');

const URL_OK = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/;

function isGoogle(url) {
  try {
    const h = new URL(url).hostname;
    return h === 'script.google.com' || h.endsWith('.googleusercontent.com') || h === 'accounts.google.com' ||
      h === 'fonts.googleapis.com' || h === 'fonts.gstatic.com';
  } catch (e) { return false; }
}

// Discord login pages may open inside the app window (only for logging in).
function isDiscord(url) {
  try {
    const h = new URL(url).hostname;
    return h === 'discord.com' || h.endsWith('.discord.com') || h === 'discordapp.com' || h.endsWith('.discordapp.com');
  } catch (e) { return false; }
}

function allowedInApp(url) { return isGoogle(url) || isDiscord(url); }

let win;

function showOffline(reason) {
  win.loadFile(path.join(__dirname, 'offline.html'), { query: { reason: reason || '' } });
}

function loadBoard() {
  if (!URL_OK.test(config.webAppUrl)) return showOffline('nourl');
  win.loadURL(config.webAppUrl).catch(() => showOffline('net'));
}

// The page finds out it runs in the desktop app (and the update setting) from this tag.
let baseUA = '';
function tagUserAgent() {
  const portable = process.env.PORTABLE_EXECUTABLE_DIR ? '; portable' : '';
  const ua = baseUA + ' vSWAF-Desktop/' + app.getVersion() + ' (auto-' + (settings.autoUpdate ? 'on' : 'off') + portable + ')';
  app.userAgentFallback = ua;                 // used by every frame, also Google's inner frames
  if (win) win.webContents.setUserAgent(ua);
}

// The Settings page sends its commands as links to this address; we catch them here.
const CMD = 'https://script.google.com/vswaf-desktop/';
function handleCommand(url) {
  const cmd = url.slice(CMD.length).split(/[?#]/)[0];
  if (cmd === 'auto-on' || cmd === 'auto-off') {
    settings.autoUpdate = cmd === 'auto-on'; saveSettings(settings);
    autoUpdater.autoDownload = settings.autoUpdate && !process.env.PORTABLE_EXECUTABLE_DIR;
    autoUpdater.autoInstallOnAppQuit = settings.autoUpdate;
    tagUserAgent();
  } else if (cmd === 'check') {
    if (app.isPackaged) checkNow(true);
  }
}

function createWindow() {
  settings = loadSettings();
  if (!baseUA) baseUA = app.userAgentFallback;
  tagUserAgent();
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'vSWAF Mission Board',
    backgroundColor: '#0B2545',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegrationInSubFrames: true          // the Mission Board page sits in Google's iframes
    }
  });

  tagUserAgent();

  // Keep the window title fixed.
  win.on('page-title-updated', (e) => e.preventDefault());

  // Links to other sites open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!allowedInApp(url) && /^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The offline page's Try again button goes to app://retry/.
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(CMD)) { e.preventDefault(); handleCommand(url); return; }
    if (url === 'app://retry/') { e.preventDefault(); loadBoard(); return; }
    if (url.startsWith('file:')) return;
    if (!allowedInApp(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });

  // Discord's login sends the window back to the web app with a redirect; only allow known sites.
  win.webContents.on('will-redirect', (e, url) => {
    if (url.startsWith(CMD)) { e.preventDefault(); return; }
    if (!allowedInApp(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });

  // Hide Google's "This app was created by a Google Apps Script user" bar on our own web app page.
  // (The same as pressing its X; it only runs on script.google.com inside this app.)
  // It can be in the top page or in one of Google's frames, so we check every frame.
  const HIDE_BAR = `(() => {
    if (window.__vswafBar) return; window.__vswafBar = true;
    const hide = () => {
      if (!document.body || document.getElementById('appRoot')) return;   // never touch the Mission Board itself
      document.querySelectorAll('body *').forEach((el) => {
        if (el.tagName === 'IFRAME' || el.querySelector('iframe')) return;
        const t = el.textContent || '';
        if (t.indexOf('Google Apps Script') < 0 || t.length > 400) return;
        let top = el;
        while (top.parentElement && top.parentElement !== document.body && !top.parentElement.querySelector('iframe')) top = top.parentElement;
        if (top.style.display !== 'none') top.style.display = 'none';
      });
    };
    hide();
    new MutationObserver(hide).observe(document.documentElement, { childList: true, subtree: true });
  })();`;
  const hideBarEverywhere = () => {
    let host = '';
    try { host = new URL(win.webContents.getURL()).hostname; } catch (e) {}
    if (host !== 'script.google.com') return;
    win.webContents.mainFrame.framesInSubtree.forEach((f) => { f.executeJavaScript(HIDE_BAR).catch(() => {}); });
  };
  win.webContents.on('did-finish-load', hideBarEverywhere);
  win.webContents.on('did-frame-finish-load', hideBarEverywhere);

  // No internet: show the offline page with a Retry button.
  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) showOffline('net');
  });

  setupSettingsBridge();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'vSWAF',
      submenu: [
        { label: 'Reload board', accelerator: 'F5', click: () => loadBoard() },
        { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit' }
      ]
    }
  ]));

  loadBoard();
  checkForUpdates();
}

// ---- Settings page in the app talks to us here ----
function fromOurPage(e) {
  const o = (e.senderFrame && e.senderFrame.origin) || '';
  return o === 'https://script.google.com' || /\.googleusercontent\.com$/.test(o);
}
let bridgeReady = false;
function setupSettingsBridge() {
  if (bridgeReady) return; bridgeReady = true;
  ipcMain.handle('vswaf:get', (e) => {
    if (!fromOurPage(e)) return null;
    return { version: app.getVersion(), autoUpdate: settings.autoUpdate, portable: !!process.env.PORTABLE_EXECUTABLE_DIR };
  });
  ipcMain.handle('vswaf:set-auto', (e, on) => {
    if (!fromOurPage(e)) return null;
    settings.autoUpdate = !!on; saveSettings(settings);
    autoUpdater.autoDownload = settings.autoUpdate && !process.env.PORTABLE_EXECUTABLE_DIR;
    autoUpdater.autoInstallOnAppQuit = settings.autoUpdate;
    return settings.autoUpdate;
  });
  ipcMain.handle('vswaf:check', (e) => {
    if (!fromOurPage(e)) return null;
    if (!app.isPackaged) return 'dev';
    checkNow(true);
    return 'checking';
  });
}

// ---- Updates (from the GitHub Releases page) ----
// Automatic updates ON:  downloads in the background, then asks to restart.
// Automatic updates OFF: only tells you a new version exists and lets you choose.
// The portable .exe can't update itself, so it only links to the download page.
const RELEASES = 'https://github.com/CeeTee32/vswaf-mission-board/releases/latest';
let manualCheck = false;

function checkNow(manual) {
  if (!app.isPackaged) return;
  manualCheck = !!manual;
  autoUpdater.checkForUpdates().catch(() => {});
}

function checkForUpdates() {
  if (!app.isPackaged) return;
  const portable = !!process.env.PORTABLE_EXECUTABLE_DIR;
  autoUpdater.autoDownload = settings.autoUpdate && !portable;
  autoUpdater.autoInstallOnAppQuit = settings.autoUpdate;

  autoUpdater.on('error', () => {
    if (manualCheck) dialog.showMessageBox(win, { type: 'warning', message: 'Could not check for updates.', detail: 'Check your internet connection and try again.' });
    manualCheck = false;
  });
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) dialog.showMessageBox(win, { type: 'info', message: 'You have the latest version (' + app.getVersion() + ').' });
    manualCheck = false;
  });
  autoUpdater.on('update-available', (info) => {
    const wasManual = manualCheck; manualCheck = false;
    if (autoUpdater.autoDownload) return;                     // downloading by itself; asks when ready
    if (portable) {
      dialog.showMessageBox(win, {
        type: 'info', buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1,
        title: 'New version', message: 'vSWAF Mission Board ' + info.version + ' is available.',
        detail: 'Download the new version from the Releases page.'
      }).then((r) => { if (r.response === 0) shell.openExternal(RELEASES); });
      return;
    }
    if (!settings.autoUpdate && !wasManual && settings.skipped === info.version) return;
    dialog.showMessageBox(win, {
      type: 'info', buttons: ['Update now', 'Not now', 'Skip this version'], defaultId: 0, cancelId: 1,
      title: 'New version', message: 'vSWAF Mission Board ' + info.version + ' is available.',
      detail: 'Automatic updates are off. Do you want to update?'
    }).then((r) => {
      if (r.response === 0) autoUpdater.downloadUpdate().catch(() => {});
      if (r.response === 2) { settings.skipped = info.version; saveSettings(settings); }
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(win, {
      type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Update ready', message: 'vSWAF Mission Board ' + info.version + ' is ready.',
      detail: 'Restart now to update, or it updates the next time you close the app.'
    }).then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(); else autoUpdater.autoInstallOnAppQuit = true; });
  });

  checkNow(false);
  setInterval(() => checkNow(false), 4 * 60 * 60 * 1000);   // every 4 hours
}

// Only one copy of the app at a time.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
