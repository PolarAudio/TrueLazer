'use strict';

/**
 * TrueLazer Companion (Laser Zone Tool) — LAN server, Step 1.
 *
 * Serves a PIN-protected HTTP API so a phone/tablet on the same LAN
 * (TrueLazer AP / ShowNet) can read and adjust projector outputs while
 * the operator walks the room.
 *
 * Transport: HTTP JSON + Server-Sent Events (SSE). SSE is chosen over
 * WebSocket for this step: zero new dependencies, built-in reconnect
 * on phones, and presence = an open stream. Reads/writes are HTTP,
 * live push is SSE. The stream hub is isolated so a WS swap stays
 * possible without touching the API.
 *
 * State: the desktop main process stays the source of truth. This
 * server only validates, revisions, and fans out settings. Persistence
 * and the desktop broadcast happen via the injected callbacks, which
 * main.js wires to electron-store (dacOutputSettings) exactly like
 * the existing set-dac-output-settings merge.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { URL } = require('url');
const { startMdns } = require('./companion-mdns.cjs');

const COMPANION_VERSION = '0.2.0';
const DEFAULT_PORT = 5180;
const DEFAULT_HOST = '0.0.0.0';
const MAX_BODY_BYTES = 256 * 1024;
const MAX_SAFETY_ZONES = 16;
const HEARTBEAT_MS = 20000;
const LOCK_TTL_MS = 10000;
const LOCK_PRUNE_MS = 5000;

// Fields a companion client may write. Mirrors DEFAULT_OUTPUT_SETTINGS
// in src/components/OutputSettingsWindow.jsx minus the desktop-only set.
const ALLOWED_FIELDS = new Set([
  'name',
  'safetyZones',
  'zoneOutlineEnabled',
  'outputArea',
  'transformationEnabled',
  'transformationMode',
  'testLineEnabled',
  'testLineY',
  'verticalTestLineEnabled',
  'testLineX',
  'testLineLagComp',
  'testLineLagCompStart',
  'testLineLagCompEnd',
  'testLineShiftX',
  'testLineShiftY',
  'flipX',
  'flipY',
  'dimmer',
]);

// PPS controls are desktop-exclusive. Any of these in a patch fails the
// whole request so the client never silently applies a partial change.
const FORBIDDEN_FIELDS = new Set([
  'targetMode',
  'ppsPreset',
  'ppsOverride',
  'targetFps',
  'pps',
  'targetPps',
]);

const BOOL_FIELDS = new Set([
  'zoneOutlineEnabled',
  'transformationEnabled',
  'testLineEnabled',
  'verticalTestLineEnabled',
  'flipX',
  'flipY',
]);

const NUM01_FIELDS = new Set(['testLineY', 'testLineX']);
// Test-line lag compensation is a fraction of the line length.
const NUM_LAG_FIELDS = new Set([
  'testLineLagComp',
  'testLineLagCompStart',
  'testLineLagCompEnd',
]);
const NUM_SHIFT_FIELDS = new Set(['testLineShiftX', 'testLineShiftY']);

// Minimal defaults so every output the API returns has a complete shape
// even when the desktop store has never seen it. Kept in sync by hand
// with DEFAULT_OUTPUT_SETTINGS (which lives in an ESM/JSX module and
// cannot be require()'d from CommonJS).
const DEFAULT_SETTINGS = Object.freeze({
  name: '',
  safetyZones: [],
  zoneOutlineEnabled: false,
  outputArea: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
  transformationEnabled: false,
  transformationMode: 'crop',
  testLineEnabled: false,
  testLineY: 0.5,
  verticalTestLineEnabled: false,
  testLineX: 0.5,
  testLineLagComp: 0,
  testLineLagCompStart: 0,
  testLineLagCompEnd: 0,
  testLineShiftX: 0,
  testLineShiftY: 0,
  flipX: false,
  flipY: false,
  dimmer: 1,
});

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function generatePin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function isValidPin(pin) {
  return typeof pin === 'string' && /^\d{6}$/.test(pin);
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ax = Buffer.from(a);
  const bx = Buffer.from(b);
  if (ax.length !== bx.length) return false;
  return crypto.timingSafeEqual(ax, bx);
}

/**
 * Validate and normalize one {x,y,w,h} rect in 0..1 space.
 * Returns the clamped rect, or null when it is not usable.
 */
function sanitizeRect(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) ||
      !isFiniteNumber(raw.w) || !isFiniteNumber(raw.h)) {
    return null;
  }
  let { x, y, w, h } = raw;
  // Clamp position first, then size to the remaining room.
  x = clamp01(x);
  y = clamp01(y);
  w = Math.min(clamp01(w), 1 - x);
  h = Math.min(clamp01(h), 1 - y);
  // A rect that clamping collapsed to a sliver is usable as long as it
  // keeps a minimum visible size; otherwise it is a bad drag point.
  if (w < 0.005 || h < 0.005) return null;
  // Round to avoid float dust like 0.30000000004 in stored settings.
  const r = (n) => Math.round(n * 100000) / 100000;
  return { x: r(x), y: r(y), w: r(w), h: r(h) };
}

function sanitizeZones(raw) {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_SAFETY_ZONES) return null;
  const out = [];
  for (const z of raw) {
    const r = sanitizeRect(z);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

/** Total blanked area (sum of w*h) — used to flag shrink edits. */
function totalZoneArea(zones) {
  if (!Array.isArray(zones)) return 0;
  return zones.reduce((acc, z) => acc + (Number(z?.w) || 0) * (Number(z?.h) || 0), 0);
}

/**
 * Validate a client patch against the allow/forbid lists.
 * @returns {{ok:true, patch:object} | {ok:false, status:number, code:string, error:string}}
 */
function sanitizePatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, code: 'BAD_PATCH', error: 'Patch must be an object.' };
  }
  const patch = {};
  for (const [key, value] of Object.entries(raw)) {
    // Control keys the server reads itself, never stored.
    if (key === 'pin' || key === 'baseRevision' || key === 'clientId') continue;
    if (key === 'patch') continue;
    if (FORBIDDEN_FIELDS.has(key)) {
      return { ok: false, status: 400, code: 'PPS_NOT_ALLOWED', error: `"${key}" is desktop-only (PPS settings).` };
    }
    if (!ALLOWED_FIELDS.has(key)) {
      return { ok: false, status: 400, code: 'UNKNOWN_FIELD', error: `Field "${key}" is not remote-editable.` };
    }
    if (key === 'safetyZones') {
      const zones = sanitizeZones(value);
      if (!zones) {
        return { ok: false, status: 400, code: 'BAD_ZONES', error: `safetyZones must be 0..${MAX_SAFETY_ZONES} rects in 0..1 space.` };
      }
      patch.safetyZones = zones;
    } else if (key === 'outputArea') {
      const r = sanitizeRect(value);
      if (!r) {
        return { ok: false, status: 400, code: 'BAD_RECT', error: 'outputArea must be a rect {x,y,w,h} in 0..1 space.' };
      }
      patch.outputArea = r;
    } else if (key === 'name') {
      if (typeof value !== 'string') {
        return { ok: false, status: 400, code: 'BAD_NAME', error: 'name must be a string.' };
      }
      patch.name = value.slice(0, 64);
    } else if (key === 'dimmer') {
      if (!isFiniteNumber(value)) {
        return { ok: false, status: 400, code: 'BAD_DIMMER', error: 'dimmer must be a number 0..1.' };
      }
      patch.dimmer = clamp01(value);
    } else if (BOOL_FIELDS.has(key)) {
      patch[key] = value === true;
    } else if (NUM01_FIELDS.has(key)) {
      if (!isFiniteNumber(value)) {
        return { ok: false, status: 400, code: 'BAD_NUMBER', error: `${key} must be a number 0..1.` };
      }
      patch[key] = clamp01(value);
    } else if (NUM_LAG_FIELDS.has(key)) {
      if (!isFiniteNumber(value)) {
        return { ok: false, status: 400, code: 'BAD_NUMBER', error: `${key} must be a number 0..1.` };
      }
      patch[key] = clamp01(value);
    } else if (NUM_SHIFT_FIELDS.has(key)) {
      if (!isFiniteNumber(value)) {
        return { ok: false, status: 400, code: 'BAD_NUMBER', error: `${key} must be a number -1..1.` };
      }
      patch[key] = Math.min(1, Math.max(-1, value));
    } else if (key === 'transformationMode') {
      if (value !== 'crop' && value !== 'scale') {
        return { ok: false, status: 400, code: 'BAD_MODE', error: 'transformationMode must be "crop" or "scale".' };
      }
      patch.transformationMode = value;
    } else {
      // No other branches: ALLOWED_FIELDS is exhaustive above.
      return { ok: false, status: 400, code: 'UNKNOWN_FIELD', error: `Field "${key}" is not remote-editable.` };
    }
  }
  return { ok: true, patch };
}

function settingsForKey(key, map) {
  const stored = (map && typeof map === 'object') ? map[key] : undefined;
  const base = { ...DEFAULT_SETTINGS };
  if (stored && typeof stored === 'object') {
    Object.assign(base, stored);
    // Shallow copy nested objects so an SSE client can never mutate the store.
    base.outputArea = { ...DEFAULT_SETTINGS.outputArea, ...(stored.outputArea || {}) };
    base.safetyZones = Array.isArray(stored.safetyZones) ? stored.safetyZones.slice() : [];
  }
  return base;
}

/** LAN IPv4 addresses (non-internal) for building the QR URL. */
function getLanAddresses() {
  const nets = os.networkInterfaces() || {};
  const out = [];
  for (const [name, list] of Object.entries(nets)) {
    for (const net of list || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('127.')) continue;
      out.push({ name, address: net.address });
    }
  }
  return out;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Body too large'), { status: 413, code: 'BODY_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400, code: 'BAD_JSON' })); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function contentTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': case '.map': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.ico': return 'image/x-icon';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

function placeholderHtml(status) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>TrueLazer Companion</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:480px;padding:24px}code{background:#222;padding:2px 6px;border-radius:4px}h1{font-size:20px}</style>
</head><body><main>
<h1>TrueLazer Companion</h1>
<p>Open with your PIN: <code>/?pin=123456</code> — the touch zone tool loads there.</p>
<p>Status: <strong>${status.running ? 'running' : 'stopped'}</strong> &middot; port ${status.port}</p>
<p>Outputs API: <code>/api/outputs?pin=123456</code></p>
</main></body></html>`;
}

/**
 * @param {object} opts
 * @param {number} [opts.port]
 * @param {string} [opts.host]
 * @param {string} [opts.pin] — 6 digits; generated when omitted.
 * @param {() => object} [opts.getSettingsMap]
 * @param {(key:string, next:object, meta:object) => void} [opts.applySettingsPatch]
 * @param {string} [opts.staticDir] — build output served at / (Step 2).
 * @param {{info:Function, warn:Function, error:Function}} [opts.logger]
 */
function createCompanionServer(opts = {}) {
  const host = opts.host || DEFAULT_HOST;
  const requestedPort = Number.isFinite(opts.port) ? opts.port : DEFAULT_PORT;
  const logger = opts.logger || console;
  const getSettingsMap = typeof opts.getSettingsMap === 'function' ? opts.getSettingsMap : () => ({});
  const applySettingsPatch = typeof opts.applySettingsPatch === 'function' ? opts.applySettingsPatch : null;
  const staticDir = opts.staticDir ? path.resolve(opts.staticDir) : null;

  const revisions = new Map(); // output key -> integer revision
  const memory = new Map();    // fallback store when no applySettingsPatch is injected
  const locks = new Map();     // output key -> { clientId, since, expiresAt }
  const clients = new Set();   // { id, res, connectedAt, ip }
  const recentEdits = [];      // newest last, cap 20 — desktop audit trail
  let pin = isValidPin(opts.pin) ? opts.pin : generatePin();
  let startedAt = null;
  let pruneTimer = null;
  let mdns = null;

  // The server's view of the settings map: injected store wins, the
  // in-memory fallback only fills keys the store has never seen.
  const readMap = () => {
    const map = getSettingsMap() || {};
    return map;
  };

  let server = null;

  function getRevision(key) {
    return revisions.get(key) || 1;
  }

  function getClients() {
    return [...clients].map((c) => ({ id: c.id, ip: c.ip, connectedAt: c.connectedAt }));
  }

  function writeSse(client, event, data) {
    try {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch { /* socket already gone — 'close' handler cleans up */ }
  }

  function broadcast(event, data, exceptId) {
    for (const c of clients) {
      if (exceptId && c.id === exceptId) continue;
      writeSse(c, event, data);
    }
  }

  function broadcastClients() {
    broadcast('clients', { count: clients.size, clients: getClients() });
  }

  // --- Per-output edit locks (Step 2) -------------------------------------
  // First companion client to drag an output owns it until release or TTL.
  // The desktop always bypasses locks. Disconnect releases all its locks.
  function snapshotLocks() {
    const now = Date.now();
    for (const [key, rec] of locks) {
      if (rec.expiresAt < now) locks.delete(key);
    }
    return Object.fromEntries(
      [...locks.entries()].map(([k, v]) => [k, { clientId: v.clientId, since: v.since, expiresAt: v.expiresAt }])
    );
  }

  function getLock(key) {
    const rec = locks.get(key);
    if (!rec) return null;
    if (rec.expiresAt < Date.now()) {
      locks.delete(key);
      broadcast('locks', { locks: snapshotLocks() });
      return null;
    }
    return rec;
  }

  function acquireLock(key, clientId) {
    if (!clientId) return { ok: false, code: 'BAD_CLIENT_ID', status: 400, error: 'clientId required.' };
    const existing = getLock(key);
    if (existing && existing.clientId !== clientId) {
      return { ok: false, code: 'LOCKED', status: 423, error: `Output is being edited by ${existing.clientId}.`, owner: existing.clientId };
    }
    const now = new Date().toISOString();
    locks.set(key, { clientId, since: existing ? existing.since : now, expiresAt: Date.now() + LOCK_TTL_MS });
    broadcast('locks', { locks: snapshotLocks() });
    return { ok: true, lock: getLock(key) };
  }

  function releaseLock(key, clientId) {
    const existing = getLock(key);
    if (!existing) return { ok: true };
    if (clientId && existing.clientId !== clientId) {
      return { ok: false, code: 'NOT_OWNER', status: 403, error: 'Lock is held by another client.' };
    }
    locks.delete(key);
    broadcast('locks', { locks: snapshotLocks() });
    return { ok: true };
  }

  function releaseLocksFor(clientId) {
    if (!clientId) return;
    let changed = false;
    for (const [key, rec] of locks) {
      if (rec.clientId === clientId) { locks.delete(key); changed = true; }
    }
    if (changed) broadcast('locks', { locks: snapshotLocks() });
  }

  function renewLock(key, clientId) {
    if (!clientId) return;
    const existing = getLock(key);
    if (!existing) { acquireLock(key, clientId); return; }
    if (existing.clientId === clientId) {
      existing.expiresAt = Date.now() + LOCK_TTL_MS;
      // No broadcast needed — owner unchanged, TTL is server-internal.
    }
  }

  function getLocks() {
    return snapshotLocks();
  }

  function getRecentEdits() {
    return recentEdits.slice(-20).reverse();
  }

  function recordEdit(key, clientId, revision, fields, shrink) {
    recentEdits.push({ key, clientId: clientId || 'anonymous', revision, fields: fields || [], shrink: !!shrink, at: new Date().toISOString() });
    if (recentEdits.length > 40) recentEdits.splice(0, recentEdits.length - 40);
  }

  function checkPin(req, url, body) {
    const header = req.headers['x-companion-pin'];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    const candidate = fromHeader || (url && url.searchParams.get('pin')) ||
      (body && typeof body.pin === 'string' ? body.pin : null);
    if (!candidate) return false;
    return safeEqual(String(candidate), pin);
  }

  function serveStatic(req, res, pathname) {
    if (!staticDir) return false;
    // SPA: any non-API GET that has no real file serves index.html.
    const isApi = pathname.startsWith('/api/');
    const safe = path.normalize(pathname).replace(/^([\\/])+/, '');
    if (safe.includes('..')) return false;
    // Vite puts shared chunks in dist/assets/, while the companion entry
    // lands at dist/companion/index.html. Try the companion dir first, then
    // the sibling assets dir, so /assets/*.js serves from either layout.
    const assetsDir = path.join(staticDir, '..', 'assets');
    const candidates = [
      path.join(staticDir, safe === '' ? 'index.html' : safe),
      path.join(assetsDir, path.basename(safe)),
      safe.startsWith('assets/') ? path.join(staticDir, '..', safe) : null,
    ].filter(Boolean);
    let target = null;
    for (const c of candidates) {
      if (!c.startsWith(staticDir) && !c.startsWith(assetsDir)) continue;
      try {
        if (fs.statSync(c).isFile()) { target = c; break; }
      } catch {}
    }
    if (!target) {
      if (!isApi && (safe === '' || !path.extname(safe))) {
        const fallback = path.join(staticDir, 'index.html');
        if (fs.existsSync(fallback)) target = fallback;
      }
      if (!target) return false;
    }
    try {
      // readFileSync keeps this working from inside app.asar on packaged
      // builds. The companion bundle is <500 KB; sync cost per request
      // is negligible next to the network round-trip.
      const data = fs.readFileSync(target);
      res.writeHead(200, {
        'Content-Type': contentTypeFor(target),
        'Cache-Control': 'no-cache',
      });
      res.end(data);
      return true;
    } catch {
      return false;
    }
  }

  async function handle(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { sendJson(res, 400, { ok: false, error: 'Bad URL' }); return; }
    const pathname = url.pathname;

    // CORS for LAN dev: the companion is same-origin in production; this
    // just lets curl / desktop tooling call the API from another origin.
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET,PATCH,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Companion-Pin,X-Client-Id',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (pathname === '/api/health' || pathname === '/api/ping') {
      sendJson(res, 200, {
        ok: true, service: 'truelazer-companion', version: COMPANION_VERSION,
        pinRequired: true, clients: clients.size, uptimeSeconds: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/stream') {
      if (!checkPin(req, url)) {
        sendJson(res, 401, { ok: false, code: 'BAD_PIN', error: 'Valid PIN required.' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      // Flush headers on proxies that buffer (Express-style defs).
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      // Client may claim its own stable ID so PATCH + lock + stream share
      // one identity (disconnect then releases that ID's locks).
      const claimed = String(url.searchParams.get('clientId') || '');
      const id = /^[A-Za-z0-9_-]{1,64}$/.test(claimed) ? claimed : crypto.randomUUID();
      const client = {
        id,
        res,
        connectedAt: new Date().toISOString(),
        ip: (req.socket && req.socket.remoteAddress) || '',
      };
      clients.add(client);
      writeSse(client, 'connected', {
        clientId: client.id, clients: clients.size,
        revisions: Object.fromEntries(revisions),
        locks: snapshotLocks(),
        serverTime: new Date().toISOString(),
      });
      broadcastClients();
      const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, HEARTBEAT_MS);
      const cleanup = () => {
        clearInterval(hb);
        if (clients.delete(client)) {
          releaseLocksFor(client.id);
          broadcastClients();
        }
      };
      req.on('close', cleanup);
      res.on('close', cleanup);
      res.on('error', cleanup);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/outputs') {
      if (!checkPin(req, url)) {
        sendJson(res, 401, { ok: false, code: 'BAD_PIN', error: 'Valid PIN required.' });
        return;
      }
      const map = readMap();
      const locksNow = snapshotLocks();
      const outputs = [];
      const keys = new Set([...Object.keys(map || {}), ...memory.keys()]);
      for (const key of [...keys].sort()) {
        const settings = memory.has(key) && !(map && map[key])
          ? memory.get(key)
          : settingsForKey(key, map);
        outputs.push({ key, revision: getRevision(key), settings, lock: locksNow[key] || null });
      }
      sendJson(res, 200, { ok: true, outputs, locks: locksNow, clientCount: clients.size, serverTime: new Date().toISOString() });
      return;
    }

    // Per-output edit lock: acquire / release. Body: { clientId, action }.
    const lockMatch = pathname.match(/^\/api\/outputs\/([^/]+)\/lock$/);
    if (lockMatch && req.method === 'POST') {
      let key;
      try { key = decodeURIComponent(lockMatch[1]); } catch { key = lockMatch[1]; }
      let body;
      try { body = await readJsonBody(req); }
      catch (e) {
        sendJson(res, e.status || 400, { ok: false, code: e.code || 'BAD_BODY', error: e.message });
        return;
      }
      if (!checkPin(req, url, body)) {
        sendJson(res, 401, { ok: false, code: 'BAD_PIN', error: 'Valid PIN required.' });
        return;
      }
      const clientId = (req.headers['x-client-id']) ||
        (body && typeof body.clientId === 'string' ? body.clientId : null) ||
        url.searchParams.get('clientId');
      const action = body && body.action;
      if (action === 'release') {
        const r = releaseLock(key, clientId);
        if (!r.ok) { sendJson(res, r.status, { ok: false, code: r.code, error: r.error }); return; }
        sendJson(res, 200, { ok: true, key, lock: getLock(key), locks: snapshotLocks() });
        return;
      }
      // Default: acquire (also acts as renew when already owned).
      const r = acquireLock(key, clientId);
      if (!r.ok) { sendJson(res, r.status, { ok: false, code: r.code, error: r.error, owner: r.owner || null }); return; }
      sendJson(res, 200, { ok: true, key, lock: getLock(key), locks: snapshotLocks() });
      return;
    }

    const m = pathname.match(/^\/api\/outputs\/([^/]+)$/);
    if (m && (req.method === 'PATCH' || req.method === 'POST')) {
      let key;
      try { key = decodeURIComponent(m[1]); } catch { key = m[1]; }
      let body;
      try { body = await readJsonBody(req); }
      catch (e) {
        sendJson(res, e.status || 400, { ok: false, code: e.code || 'BAD_BODY', error: e.message });
        return;
      }
      if (!checkPin(req, url, body)) {
        sendJson(res, 401, { ok: false, code: 'BAD_PIN', error: 'Valid PIN required.' });
        return;
      }
      const rawPatch = (body && typeof body.patch === 'object' && body.patch !== null)
        ? body.patch
        : body;
      const checked = sanitizePatch(rawPatch || {});
      if (!checked.ok) {
        sendJson(res, checked.status, { ok: false, code: checked.code, error: checked.error });
        return;
      }
      const base = body && body.baseRevision;
      if (base !== undefined && base !== null && Number(base) !== getRevision(key)) {
        sendJson(res, 409, {
          ok: false, code: 'STALE_REVISION', revision: getRevision(key),
          error: `Output is at revision ${getRevision(key)}, not ${base}. Re-read and retry.`,
        });
        return;
      }
      const patchClientId = (req.headers['x-client-id']) ||
        (body && typeof body.clientId === 'string' ? body.clientId : null) || null;
      // Edit lock: a locked output only accepts its owner. Anonymous
      // (no clientId) patches stay allowed for back-compat tooling but
      // never take or renew a lock. Desktop edits bypass locks entirely.
      const lock = getLock(key);
      if (lock && patchClientId && lock.clientId !== patchClientId) {
        sendJson(res, 423, {
          ok: false, code: 'LOCKED', revision: getRevision(key), owner: lock.clientId,
          error: `Output is locked by ${lock.clientId}. Take over after it releases.`,
        });
        return;
      }
      if (patchClientId && !lock) acquireLock(key, patchClientId);
      else if (patchClientId && lock) renewLock(key, patchClientId);
      const map = readMap();
      const current = memory.has(key) && !(map && map[key])
        ? { ...memory.get(key) }
        : settingsForKey(key, map);
      const next = { ...current, ...checked.patch };
      const revision = getRevision(key) + 1;
      revisions.set(key, revision);
      const clientId = patchClientId;
      const meta = { revision, clientId, source: 'companion', at: new Date().toISOString() };
      try {
        if (applySettingsPatch) applySettingsPatch(key, next, meta);
        else memory.set(key, next);
      } catch (e) {
        revisions.set(key, revision - 1);
        logger.error && logger.error('[Companion] apply failed:', e);
        sendJson(res, 500, { ok: false, code: 'APPLY_FAILED', error: e.message });
        return;
      }
      logger.info && logger.info(`[Companion] ${key} -> r${revision} by ${clientId || 'anonymous'} (${Object.keys(checked.patch).join(',') || 'none'})`);
      const shrink = current && (totalZoneArea(current.safetyZones) > totalZoneArea(next.safetyZones));
      recordEdit(key, clientId, revision, Object.keys(checked.patch), shrink);
      broadcast('settings-changed', { key, revision, settings: next, clientId });
      sendJson(res, 200, { ok: true, key, revision, settings: next });
      return;
    }

    // Static companion bundle (Step 2+). Falls through to a placeholder.
    if (req.method === 'GET' && serveStatic(req, res, pathname)) return;
    try {
      const status = getStatus();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(placeholderHtml(status));
    } catch {
      sendJson(res, 404, { ok: false, error: 'Not found' });
    }
  }

  function getStatus() {
    const actualPort = server && server.address() ? server.address().port : requestedPort;
    return {
      running: !!(server && server.listening),
      host,
      port: actualPort,
      pin,
      clients: clients.size,
      locks: snapshotLocks(),
      lastEdits: getRecentEdits(),
      mdns: { service: '_truelazer._tcp.local.', instance: 'TrueLazer Zones._truelazer._tcp.local.', active: !!mdns },
      startedAt: startedAt ? new Date(startedAt).toISOString() : null,
      lan: getLanAddresses(),
      url: buildUrl(null, actualPort),
    };
  }

  function buildUrl(lanAddress, port) {
    const ip = lanAddress || '127.0.0.1';
    return `http://${ip}:${port}/?pin=${pin}`;
  }

  function start() {
    if (server && server.listening) return Promise.resolve(getStatus());
    server = http.createServer((req, res) => {
      handle(req, res).catch((e) => {
        logger.error && logger.error('[Companion] request failed:', e);
        if (!res.headersSent) sendJson(res, 500, { ok: false, code: 'INTERNAL', error: 'Internal error' });
        else { try { res.end(); } catch {} }
      });
    });
    return new Promise((resolve, reject) => {
      server.on('error', reject);
      server.listen(requestedPort, host, () => {
        startedAt = Date.now();
        // Expire stale locks even when nobody is chatting (phones parked).
        pruneTimer = setInterval(() => { snapshotLocks(); }, LOCK_PRUNE_MS);
        if (typeof pruneTimer.unref === 'function') pruneTimer.unref();
        // Discovery only; failures must never break the HTTP server.
        try { mdns = startMdns(server.address().port, { logger, version: COMPANION_VERSION }); }
        catch (e) { try { logger.warn && logger.warn(`[Companion] mDNS failed: ${e.message}`); } catch {} }
        const status = getStatus();
        logger.info && logger.info(`[Companion] listening on ${status.url} (pin ${pin})`);
        resolve(status);
      });
    });
  }

  function stop() {
    if (pruneTimer) { clearInterval(pruneTimer); pruneTimer = null; }
    try { mdns && mdns.stop(); } catch {}
    mdns = null;
    locks.clear();
    for (const c of [...clients]) {
      try { c.res.end(); } catch {}
    }
    clients.clear();
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      const s = server;
      server = null;
      startedAt = null;
      if (!s.listening) return resolve();
      s.close(() => resolve());
    });
  }

  return {
    start,
    stop,
    getStatus,
    getPin: () => pin,
    setPin(next) {
      if (!isValidPin(next)) throw new Error('PIN must be 6 digits.');
      pin = next;
      return pin;
    },
    getRevision,
    getRevisions: () => Object.fromEntries(revisions),
    getClients,
    getLocks,
    getRecentEdits,
    getLanAddresses,
    broadcastSettingsChanged(key, settings, revision, source) {
      const rev = revision != null ? Number(revision) : getRevision(key);
      if (Number.isFinite(rev) && !revisions.has(key)) revisions.set(key, rev);
      broadcast('settings-changed', { key, revision: rev, settings, clientId: null, source: source || 'desktop' });
    },
  };
}

module.exports = {
  COMPANION_VERSION,
  DEFAULT_PORT,
  ALLOWED_FIELDS,
  FORBIDDEN_FIELDS,
  DEFAULT_SETTINGS,
  createCompanionServer,
  generatePin,
  isValidPin,
  sanitizePatch,
  sanitizeRect,
  totalZoneArea,
  settingsForKey,
  getLanAddresses,
};
