/**
 * vSWAF Mission Board – web app "server", with Discord login.
 * Only members of your Discord server who have the pilot role can see or change anything.
 * Setup: Projektinställningar → Skriptegenskaper (see the guide), then run checkSetup once.
 * Put this in its own script file (WebApp.gs) next to Kod.gs, and the page in an HTML file called Index.
 * It reads and writes the same Google Sheet: Cargo Board, Pilot Log and Fleet.
 */

var STATUSES = ['Planned', 'Airborne', 'Completed', 'Cancelled'];

var SESSION_DAYS = 60;      // a login lasts this long on one computer
var RECHECK_HOURS = 6;      // how often the Discord role is checked again

function doGet(e) {
  var p = (e && e.parameter) || {};
  var t = HtmlService.createTemplateFromFile('Index');
  t.loginToken = '';
  t.loginError = '';
  if (p.code && p.state) {
    try { t.loginToken = finishLogin_(p.code, p.state); }
    catch (err) { t.loginError = String(err.message || err).replace(/^LOGIN_REQUIRED:\s*/, ''); }
  } else if (p.error) {
    t.loginError = 'Discord login was cancelled.';
  }
  return t.evaluate()
    .setTitle('vSWAF Mission Board')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- Discord login ----------

function cfg_() {
  var pr = PropertiesService.getScriptProperties();
  var c = {
    clientId: pr.getProperty('DISCORD_CLIENT_ID'),
    secret: pr.getProperty('DISCORD_CLIENT_SECRET'),
    guild: pr.getProperty('DISCORD_GUILD_ID'),
    role: pr.getProperty('DISCORD_ROLE_ID'),
    roleName: pr.getProperty('DISCORD_ROLE_NAME') || 'pilot',
    redirect: pr.getProperty('WEB_APP_URL') || ScriptApp.getService().getUrl()
  };
  if (!c.clientId || !c.secret || !c.guild || !c.role) throw new Error('Discord login is not set up yet. Ask the admin to run checkSetup.');
  return c;
}

/** Called by the login screen. Anyone may call it; it only returns the Discord link. */
function getLoginUrl() {
  var c = cfg_();
  var state = Utilities.getUuid();
  CacheService.getScriptCache().put('st_' + state, '1', 900);
  var url = 'https://discord.com/oauth2/authorize?response_type=code' +
    '&client_id=' + encodeURIComponent(c.clientId) +
    '&scope=' + encodeURIComponent('identify guilds.members.read') +
    '&state=' + encodeURIComponent(state) +
    '&redirect_uri=' + encodeURIComponent(c.redirect) +
    '&prompt=none';
  return { url: url, roleName: c.roleName };
}

function finishLogin_(code, state) {
  var cache = CacheService.getScriptCache();
  if (!cache.get('st_' + state)) throw new Error('The login link expired. Press Log in with Discord again.');
  cache.remove('st_' + state);
  var c = cfg_();
  var tok = discordToken_(c, { grant_type: 'authorization_code', code: code, redirect_uri: c.redirect });
  if (!tok.ok) throw new Error('Discord did not accept the login. Try again.');
  var who = checkMember_(c, tok.access);
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var now = Date.now();
  var props = PropertiesService.getScriptProperties();
  cleanSessions_(props);
  props.setProperty('S_' + token, JSON.stringify({
    uid: who.uid, name: who.name, exp: now + SESSION_DAYS * 864e5, checked: now, rt: tok.refresh
  }));
  return token;
}

function discordToken_(c, form) {
  form.client_id = c.clientId;
  form.client_secret = c.secret;
  var r = UrlFetchApp.fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'post', payload: form, muteHttpExceptions: true
  });
  var code = r.getResponseCode();
  if (code === 200) {
    var j = JSON.parse(r.getContentText());
    return { ok: true, access: j.access_token, refresh: j.refresh_token };
  }
  return { ok: false, rejected: code === 400 || code === 401 };
}

/** Throws unless the user is in the server and has the role. */
function checkMember_(c, access) {
  var r = UrlFetchApp.fetch('https://discord.com/api/v10/users/@me/guilds/' + c.guild + '/member', {
    headers: { Authorization: 'Bearer ' + access }, muteHttpExceptions: true
  });
  var code = r.getResponseCode();
  if (code === 404 || code === 403) throw new Error('LOGIN_REQUIRED: You are not a member of the vSWAF Discord server.');
  if (code !== 200) throw new Error('Discord is not answering right now. Try again in a minute.');
  var m = JSON.parse(r.getContentText());
  if ((m.roles || []).indexOf(c.role) < 0) {
    throw new Error('LOGIN_REQUIRED: You need the ' + c.roleName + ' role on the vSWAF Discord to use the Mission Board.');
  }
  var u = m.user || {};
  return { uid: u.id, name: clean_(m.nick || u.global_name || u.username) };
}

/** Every data call goes through here. Returns {uid, name} or throws LOGIN_REQUIRED. */
function auth_(token) {
  token = String(token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('LOGIN_REQUIRED: Please log in with Discord.');
  var cache = CacheService.getScriptCache();
  var hit = cache.get('ok_' + token);
  if (hit) return JSON.parse(hit);

  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('S_' + token);
  if (!raw) throw new Error('LOGIN_REQUIRED: Please log in with Discord.');
  var s = JSON.parse(raw), now = Date.now();
  if (s.exp < now) { props.deleteProperty('S_' + token); throw new Error('LOGIN_REQUIRED: Your login expired. Log in again.'); }

  if (now - s.checked > RECHECK_HOURS * 36e5) {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      raw = props.getProperty('S_' + token);           // another call may have refreshed it meanwhile
      if (!raw) throw new Error('LOGIN_REQUIRED: Please log in with Discord.');
      s = JSON.parse(raw);
      if (now - s.checked > RECHECK_HOURS * 36e5) {
        var c = cfg_();
        var tok = discordToken_(c, { grant_type: 'refresh_token', refresh_token: s.rt });
        if (!tok.ok && tok.rejected) { props.deleteProperty('S_' + token); throw new Error('LOGIN_REQUIRED: Please log in with Discord again.'); }
        if (tok.ok) {
          try { var who = checkMember_(c, tok.access); }
          catch (err) {
            if (/^LOGIN_REQUIRED/.test(err.message)) props.deleteProperty('S_' + token);
            else { s.rt = tok.refresh; props.setProperty('S_' + token, JSON.stringify(s)); }
            throw err;
          }
          s.name = who.name; s.rt = tok.refresh; s.checked = now;
          props.setProperty('S_' + token, JSON.stringify(s));
        }
        // If Discord is down, keep the pilot logged in and check again next time.
      }
    } finally {
      lock.releaseLock();
    }
  }
  var user = { uid: s.uid, name: s.name };
  cache.put('ok_' + token, JSON.stringify(user), 600);
  return user;
}

function logout(token) {
  token = String(token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return true;
  PropertiesService.getScriptProperties().deleteProperty('S_' + token);
  CacheService.getScriptCache().remove('ok_' + token);
  return true;
}

function cleanSessions_(props) {
  var all = props.getProperties(), now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('S_') !== 0) return;
    try { if (JSON.parse(all[k]).exp < now) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}

/** Run from the editor: checks the settings and shows the link to paste into Discord as Redirect. */
function checkSetup() {
  var c = cfg_();
  UrlFetchApp.fetch('https://discord.com/api/v10/gateway', { muteHttpExceptions: true }); // asks for the internet permission
  Logger.log('Settings OK.\nPaste this exact link into Discord → OAuth2 → Redirects:\n' + c.redirect);
}

/** Run from the editor if the app leaks or you want everyone to log in again. */
function logoutEveryone() {
  var props = PropertiesService.getScriptProperties(), n = 0;
  Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf('S_') === 0) { props.deleteProperty(k); n++; } });
  Logger.log(n + ' logins removed. Everyone must log in with Discord again (within 10 minutes).');
}

// ---------- Reading ----------

function getData(token) {
  var user = auth_(token);
  return data_(user);
}

function data_(user) {
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone();
  return {
    missions: readMissions_(ss),
    fleet: readFleet_(ss),
    log: readLog_(ss, tz),
    updated: Utilities.formatDate(new Date(), 'Etc/UTC', 'HH:mm') + 'Z',
    me: { name: user.name }
  };
}

function readMissions_(ss) {
  var sh = ss.getSheetByName('Cargo Board');
  var last = sh.getLastRow();
  if (last < 3) return [];
  var rng = sh.getRange(3, 1, last - 2, 12);
  var disp = rng.getDisplayValues();
  var vals = rng.getValues();
  var out = [];
  for (var i = 0; i < disp.length; i++) {
    var d = disp[i];
    if (!d[0]) continue;
    out.push({
      id: d[0], dep: d[1], depName: d[2], dst: d[3], dstName: d[4],
      cargo: d[5], aircraft: d[6],
      weight: Number(vals[i][7]) || 0,
      remaining: typeof vals[i][9] === 'number' ? vals[i][9] : 0,
      status: d[11]
    });
  }
  return out;
}

function readFleet_(ss) {
  var sh = ss.getSheetByName('Fleet');
  var d = sh.getRange('A4:L60').getDisplayValues();
  return d.filter(function (r) { return r[0] !== ''; }).map(function (r) {
    return {
      reg: r[0], type: r[1], home: r[2], parked: r[3], status: r[4],
      lastMission: r[5], lastDate: r[6], nextMission: r[9], nextDate: r[10], nextWindow: r[11]
    };
  });
}

function readLog_(ss, tz) {
  var sh = ss.getSheetByName('Pilot Log');
  var last = sh.getLastRow();
  if (last < 3) return [];
  var rng = sh.getRange(3, 1, last - 2, 17);
  var disp = rng.getDisplayValues();
  var vals = rng.getValues();
  var out = [];
  for (var i = 0; i < disp.length; i++) {
    var d = disp[i];
    if (!d[1]) continue;
    var date = vals[i][9] instanceof Date ? Utilities.formatDate(vals[i][9], tz, 'yyyy-MM-dd') : d[9];
    out.push({
      row: i + 3, deliveryId: d[0], cargoId: d[1], dep: d[2], dst: d[3],
      pilot: d[5], callsign: d[6], type: d[7], reg: d[8], date: date,
      cargo: d[4], window: d[10], qty: d[11], qtyNum: Number(vals[i][11]) || 0,
      avail: d[12], remainingAfter: d[13], check: d[14], status: d[15], ferried: d[16]
    });
  }
  return out;
}

// ---------- Writing ----------

function saveBooking(token, b) {
  var user = auth_(token);
  return writeBooking_(b, null, user);
}

/** Change an existing booking (all fields the sheet has for it). */
function editBooking(token, row, b) {
  var user = auth_(token);
  row = Number(row);
  if (!(row >= 3)) throw new Error('That booking no longer exists.');
  return writeBooking_(b, row, user);
}

function writeBooking_(b, editRow, user) {
  b = b || {};
  // New bookings are always in the logged-in pilot's Discord name; edits keep the original pilot.
  var cargoId = clean_(b.cargoId), pilot = user.name, callsign = clean_(b.callsign).toUpperCase();
  var type = clean_(b.type), reg = clean_(b.reg), date = clean_(b.date);
  var window = clean_(b.window), ferried = clean_(b.ferried).toUpperCase();
  var status = clean_(b.status) || 'Planned';
  if (!cargoId || !pilot || !reg || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Fill in mission, pilot, registration and date.');
  }
  if (STATUSES.indexOf(status) < 0) throw new Error('Unknown status.');
  if (ferried && !/^[A-Z0-9]{4}$/.test(ferried)) throw new Error('The ICAO code must be 4 letters, e.g. ENGM.');
  if (window && !toMinutes_(window)) throw new Error('Write Book b/w like 1400-1630 (Zulu).');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActive();
    var tz = ss.getSpreadsheetTimeZone();
    var sh = ss.getSheetByName('Pilot Log');
    var log = readLog_(ss, tz);
    var own = null;
    if (editRow) {
      own = log.filter(function (l) { return l.row === editRow; })[0];
      if (!own || (b.key && rowKey_(own) !== b.key)) {
        throw new Error('The Pilot Log changed while you were editing (a row was removed). Your booking was not changed. Press Refresh and try again.');
      }
      pilot = own.pilot || pilot;
    }
    var mission = readMissions_(ss).filter(function (m) { return m.id === cargoId; })[0];
    if (!mission) throw new Error('Mission ' + cargoId + ' was not found on the Cargo Board.');
    var fleetHit = readFleet_(ss).filter(function (f) { return f.reg === reg; })[0];
    if (!fleetHit) throw new Error('Registration ' + reg + ' is not on the Fleet tab.');
    if (!type) type = fleetHit.type;

    var qty = '';
    if (cargoId !== 'FERRY') {
      qty = Math.round(Number(String(b.qty).replace(/\s/g, '').replace(',', '.')));
      if (!(qty > 0)) throw new Error('Enter how many kg you take.');
      // When editing the same mission, this booking's own kg is free to reuse.
      var room = mission.remaining + (own && own.cargoId === cargoId && own.status !== 'Cancelled' ? own.qtyNum : 0);
      if (status !== 'Cancelled' && qty > room) {
        throw new Error('Only ' + room.toLocaleString('en-US') + ' kg is available on ' + cargoId + '.');
      }
    } else if (!ferried) {
      throw new Error('For a ferry, enter the arrival ICAO.');
    }

    // Same aircraft already booked that day at an overlapping time?
    if (status === 'Planned' || status === 'Airborne') {
      var mine = toMinutes_(window);
      log.forEach(function (l) {
        if (l.row === editRow || l.reg !== reg || l.date !== date) return;
        if (l.status !== 'Planned' && l.status !== 'Airborne') return;
        var other = toMinutes_(l.window);
        var overlap = !mine || !other || (mine[0] < other[1] && other[0] < mine[1]);
        if (overlap) {
          throw new Error(reg + ' is already booked on ' + date + (l.window ? ' ' + l.window : '') +
            ' by ' + (l.pilot || 'another pilot') + ' (' + l.cargoId + ').');
        }
      });
    }

    var row = editRow || firstFreeRow_(sh);
    sh.getRange(row, 2).setValue(cargoId);
    sh.getRange(row, 6, 1, 7).setValues([[pilot, callsign, type, reg, Utilities.parseDate(date, tz, 'yyyy-MM-dd'), window, qty]]);
    sh.getRange(row, 16, 1, 2).setValues([[status, ferried]]);
    SpreadsheetApp.flush();
    return data_(user);
  } finally {
    lock.releaseLock();
  }
}

function updateStatus(token, row, status, ferried, key) {
  var user = auth_(token);
  row = Number(row);
  status = clean_(status);
  ferried = clean_(ferried).toUpperCase();
  if (STATUSES.indexOf(status) < 0) throw new Error('Unknown status.');
  if (ferried && !/^[A-Z0-9]{4}$/.test(ferried)) throw new Error('The ICAO code must be 4 letters, e.g. ENGM.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName('Pilot Log');
    if (!(row >= 3) || row > sh.getLastRow() || !sh.getRange(row, 2).getValue()) throw new Error('That booking no longer exists.');
    var cur = readLog_(SpreadsheetApp.getActive(), SpreadsheetApp.getActive().getSpreadsheetTimeZone()).filter(function (l) { return l.row === row; })[0];
    if (key && (!cur || rowKey_(cur) !== key)) {
      throw new Error('The Pilot Log changed (a row was removed). Nothing was saved. Press Refresh and try again.');
    }
    sh.getRange(row, 16, 1, 2).setValues([[status, ferried]]);
    SpreadsheetApp.flush();
    return data_(user);
  } finally {
    lock.releaseLock();
  }
}

// ---------- Helpers ----------

function firstFreeRow_(sh) {
  var last = sh.getLastRow();
  var ids = sh.getRange(3, 2, Math.max(last - 2, 1), 1).getValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === '') return i + 3;
  // Log is full: add a row with the same formulas as the one above.
  sh.insertRowAfter(last);
  sh.getRange(last, 1, 1, 19).copyTo(sh.getRange(last + 1, 1, 1, 19));
  ['B', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'P', 'Q'].forEach(function (c) { sh.getRange(c + (last + 1)).clearContent(); });
  return last + 1;
}

// Identifies a booking even if rows above it are deleted.
function rowKey_(l) {
  return [l.deliveryId, l.cargoId, l.pilot, l.reg, l.date, l.window].join('|');
}

function toMinutes_(w) {
  var m = String(w || '').match(/(\d{1,2}):?(\d{2})\s*[-–]\s*(\d{1,2}):?(\d{2})/);
  if (!m) return null;
  var a = Number(m[1]) * 60 + Number(m[2]), b = Number(m[3]) * 60 + Number(m[4]);
  if (b <= a) b += 24 * 60;
  return [a, b];
}

function clean_(v) {
  return String(v === undefined || v === null ? '' : v).trim().slice(0, 120);
}
