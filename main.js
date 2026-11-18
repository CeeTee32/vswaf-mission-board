// vSWAF Mission Board – desktop app.
// Opens the vSWAF web app (Google Apps Script) in its own window.
// All data lives in the shared Google Sheet, so every pilot sees the same board.

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
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

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'vSWAF Mission Board',
    backgroundColor: '#0B2545',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });

  // Keep the window title fixed.
  win.on('page-title-updated', (e) => e.preventDefault());

  // Links to other sites open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!allowedInApp(url) && /^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The offline page's Try again button goes to app://retry/.
  win.webContents.on('will-navigate', (e, url) => {
    if (url === 'app://retry/') { e.preventDefault(); loadBoard(); return; }
    if (url.startsWith('file:')) return;
    if (!allowedInApp(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });

  // Discord's login sends the window back to the web app with a redirect; only allow known sites.
  win.webContents.on('will-redirect', (e, url) => {
    if (!allowedInApp(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });

  // Hide Google's "This app was created by a Google Apps Script user" bar on our own web app page.
  // (The same as pressing its X; it only runs on script.google.com inside this app.)
  win.webContents.on('did-finish-load', () => {
    let host = '';
    try { host = new URL(win.webContents.getURL()).hostname; } catch (e) {}
    if (host !== 'script.google.com') return;
    win.webContents.executeJavaScript(`(() => {
      const hide = () => {
        document.querySelectorAll('body *').forEach((el) => {
          if (el.tagName === 'IFRAME' || el.querySelector('iframe')) return;
          const t = el.textContent || '';
          if (t.indexOf('Google Apps Script') < 0 || t.length > 400) return;
          let top = el;
          while (top.parentElement && top.parentElement !== document.body && !top.parentElement.querySelector('iframe')) top = top.parentElement;
          top.style.display = 'none';
        });
      };
      hide();
      new MutationObserver(hide).observe(document.body, { childList: true, subtree: true });
    })();`).catch(() => {});
  });

  // No internet: show the offline page with a Retry button.
  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) showOffline('net');
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'vSWAF',
      submenu: [
        { label: 'Reload board', accelerator: 'F5', click: () => loadBoard() },
        { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'quit', label: 'Quit' }
      ]
    }
  ]));

  loadBoard();
}

// Only one copy of the app at a time.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
