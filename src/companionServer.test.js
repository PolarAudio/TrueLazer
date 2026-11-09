import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  createCompanionServer,
  generatePin,
  isValidPin,
  sanitizePatch,
  settingsForKey,
  totalZoneArea,
} = require('../main/companion-server.cjs');

const PIN = '123456';

function makeServer(extra = {}) {
  const store = {
    '10.0.0.5:1': { name: 'Front', dimmer: 0.8, safetyZones: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] },
  };
  let calls = [];
  const server = createCompanionServer({
    port: 0,
    pin: PIN,
    getSettingsMap: () => store,
    applySettingsPatch: (key, next, meta) => {
      calls.push({ key, next, meta });
      store[key] = next;
    },
    logger: { info() {}, warn() {}, error() {} },
    ...extra,
  });
  return { server, store, calls };
}

async function start(s) {
  const status = await s.start();
  return status;
}

function origin(port) {
  return `http://127.0.0.1:${port}`;
}

describe('companion-server.cjs / PIN helpers', () => {
  it('generates a 6-digit numeric PIN', () => {
    for (let i = 0; i < 20; i++) {
      const p = generatePin();
      expect(isValidPin(p), p).toBe(true);
    }
  });
  it('validates PIN shape strictly', () => {
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('12345')).toBe(false);
    expect(isValidPin('1234567')).toBe(false);
    expect(isValidPin('abcdef')).toBe(false);
    expect(isValidPin(123456)).toBe(false);
  });
});

describe('companion-server.cjs / sanitizePatch (allow/forbid lists)', () => {
  it('accepts zones, output area, flips, dimmer and test lines, clamped', () => {
    const r = sanitizePatch({
      safetyZones: [{ x: -1, y: 0.2, w: 2, h: 0.3 }],
      outputArea: { x: 0, y: 0, w: 0.5, h: 0.5 },
      flipX: true,
      flipY: 'yes',
      dimmer: 2,
      testLineY: 1.5,
      zoneOutlineEnabled: true,
      transformationMode: 'scale',
    });
    expect(r.ok).toBe(true);
    // Clamped: x->0, w->1 (fits)
    expect(r.patch.safetyZones[0]).toEqual({ x: 0, y: 0.2, w: 1, h: 0.3 });
    expect(r.patch.dimmer).toBe(1);
    expect(r.patch.testLineY).toBe(1);
    expect(r.patch.flipX).toBe(true);
    expect(r.patch.flipY).toBe(false);
  });

  it('rejects every PPS field as desktop-only', () => {
    for (const k of ['targetMode', 'ppsPreset', 'ppsOverride', 'targetFps', 'pps', 'targetPps']) {
      const r = sanitizePatch({ [k]: 1 });
      expect(r.ok, k).toBe(false);
      expect(r.code, k).toBe('PPS_NOT_ALLOWED');
      expect(r.status, k).toBe(400);
    }
  });

  it('rejects unknown fields', () => {
    const r = sanitizePatch({ timelineFps: 60 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('UNKNOWN_FIELD');
  });

  it('rejects malformed rects', () => {
    expect(sanitizePatch({ safetyZones: [{ x: 0, y: 0, w: 0, h: 0 }] }).ok).toBe(false);
    expect(sanitizePatch({ safetyZones: 'nope' }).ok).toBe(false);
    expect(sanitizePatch({ outputArea: { x: 0, y: 0, w: 0.1 } }).ok).toBe(false);
  });

  it('ignores control keys instead of storing them', () => {
    const r = sanitizePatch({ pin: PIN, baseRevision: 3, clientId: 'abc', dimmer: 0.5 });
    expect(r.ok).toBe(true);
    expect(Object.keys(r.patch)).toEqual(['dimmer']);
  });
});

describe('companion-server.cjs / settingsForKey', () => {
  it('fills defaults for unseen outputs and mirrors stored values', () => {
    const d = settingsForKey('10.9.9.9:9', {});
    expect(d.outputArea.w).toBe(0.8);
    expect(d.dimmer).toBe(1);
    expect(d.safetyZones).toEqual([]);
    const s = settingsForKey('10.9.9.9:9', { '10.9.9.9:9': { dimmer: 0.2 } });
    expect(s.dimmer).toBe(0.2);
  });

  it('totalZoneArea sums w*h', () => {
    expect(totalZoneArea([{ x: 0, y: 0, w: 0.5, h: 0.2 }])).toBeCloseTo(0.1);
    expect(totalZoneArea([])).toBe(0);
    expect(totalZoneArea(null)).toBe(0);
  });
});

describe('companion-server.cjs / HTTP API', () => {
  let harness;
  beforeEach(async () => {
    harness = makeServer();
    harness.status = await start(harness.server);
  });
  afterEach(async () => {
    await harness.server.stop();
  });

  it('health is public', async () => {
    const res = await fetch(`${origin(harness.status.port)}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe('truelazer-companion');
  });

  it('outputs require the PIN', async () => {
    const noPin = await fetch(`${origin(harness.status.port)}/api/outputs`);
    expect(noPin.status).toBe(401);
    const badPin = await fetch(`${origin(harness.status.port)}/api/outputs?pin=000000`);
    expect(badPin.status).toBe(401);
    const ok = await fetch(`${origin(harness.status.port)}/api/outputs?pin=${PIN}`);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.outputs.some((o) => o.key === '10.0.0.5:1')).toBe(true);
  });

  it('PATCH merges, bumps revision and persists via the callback', async () => {
    const res = await fetch(`${origin(harness.status.port)}/api/outputs/${encodeURIComponent('10.0.0.5:1')}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Companion-Pin': PIN, 'X-Client-Id': 'phone-1' },
      body: JSON.stringify({ patch: { dimmer: 0.5, flipX: true }, baseRevision: 1 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revision).toBe(2);
    expect(body.settings.dimmer).toBe(0.5);
    expect(body.settings.flipX).toBe(true);
    expect(body.settings.name).toBe('Front'); // untouched field kept
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0].meta.source).toBe('companion');
  });

  it('PATCH rejects PPS and stale revisions', async () => {
    const pps = await fetch(`${origin(harness.status.port)}/api/outputs/${encodeURIComponent('10.0.0.5:1')}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Companion-Pin': PIN },
      body: JSON.stringify({ patch: { ppsPreset: 'fast' } }),
    });
    expect(pps.status).toBe(400);
    expect((await pps.json()).code).toBe('PPS_NOT_ALLOWED');
    expect(harness.calls).toHaveLength(0);

    const stale = await fetch(`${origin(harness.status.port)}/api/outputs/${encodeURIComponent('10.0.0.5:1')}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Companion-Pin': PIN },
      body: JSON.stringify({ patch: { dimmer: 0.1 }, baseRevision: 99 }),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('STALE_REVISION');
  });
});

describe('companion-server.cjs / edit locks (Step 2)', () => {
  let harness;
  const KEY = '10.0.0.5:1';
  const lockUrl = (port, key) => `${origin(port)}/api/outputs/${encodeURIComponent(key)}/lock`;

  beforeEach(async () => {
    harness = makeServer();
    harness.status = await start(harness.server);
  });
  afterEach(async () => {
    await harness.server.stop();
  });

  async function postLock(clientId, action) {
    return fetch(lockUrl(harness.status.port, KEY), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Companion-Pin': PIN, 'X-Client-Id': clientId },
      body: JSON.stringify({ clientId, action }),
    });
  }

  it('first acquire wins; second claimant gets LOCKED; owner renews', async () => {
    const a = await postLock('phone-a', 'acquire');
    expect(a.status).toBe(200);
    const b = await postLock('phone-b', 'acquire');
    expect(b.status).toBe(423);
    expect((await b.json()).code).toBe('LOCKED');
    const renew = await postLock('phone-a', 'acquire');
    expect(renew.status).toBe(200);
    expect(harness.server.getLocks()[KEY].clientId).toBe('phone-a');
  });

  it('outputs advertise the lock; non-owner PATCH is 423, owner PATCH renews', async () => {
    await postLock('phone-a', 'acquire');
    const list = await fetch(`${origin(harness.status.port)}/api/outputs?pin=${PIN}`).then((r) => r.json());
    expect(list.locks[KEY].clientId).toBe('phone-a');
    expect(list.outputs.find((o) => o.key === KEY).lock.clientId).toBe('phone-a');

    const blocked = await fetch(`${origin(harness.status.port)}/api/outputs/${encodeURIComponent(KEY)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Companion-Pin': PIN, 'X-Client-Id': 'phone-b' },
      body: JSON.stringify({ patch: { dimmer: 0.1 }, baseRevision: harness.server.getRevision(KEY) }),
    });
    expect(blocked.status).toBe(423);
    expect((await blocked.json()).owner).toBe('phone-a');

    const owner = await fetch(`${origin(harness.status.port)}/api/outputs/${encodeURIComponent(KEY)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Companion-Pin': PIN, 'X-Client-Id': 'phone-a' },
      body: JSON.stringify({ patch: { dimmer: 0.4 }, baseRevision: harness.server.getRevision(KEY) }),
    });
    expect(owner.status).toBe(200);
  });

  it('PATCH auto-acquires a free output and releases via action release', async () => {
    const patch = await fetch(`${origin(harness.status.port)}/api/outputs/${encodeURIComponent(KEY)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Companion-Pin': PIN, 'X-Client-Id': 'phone-z' },
      body: JSON.stringify({ patch: { dimmer: 0.3 }, baseRevision: harness.server.getRevision(KEY) }),
    });
    expect(patch.status).toBe(200);
    expect(harness.server.getLocks()[KEY].clientId).toBe('phone-z');

    const wrongRelease = await postLock('phone-open', 'release');
    expect(wrongRelease.status).toBe(403);
    const released = await postLock('phone-z', 'release');
    expect(released.status).toBe(200);
    expect(harness.server.getLocks()[KEY]).toBeUndefined();
  });

  it('records shrink edits in the audit trail (status.lastEdits)', async () => {
    // Shrink: 0.2x0.2 (0.04) -> 0.1x0.1 (0.01)
    const res = await fetch(`${origin(harness.status.port)}/api/outputs/${encodeURIComponent(KEY)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Companion-Pin': PIN, 'X-Client-Id': 'phone-a' },
      body: JSON.stringify({
        patch: { safetyZones: [{ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }] },
        baseRevision: harness.server.getRevision(KEY),
      }),
    });
    expect(res.status).toBe(200);
    const edits = harness.server.getRecentEdits();
    expect(edits.length).toBe(1);
    expect(edits[0].key).toBe(KEY);
    expect(edits[0].clientId).toBe('phone-a');
    expect(edits[0].shrink).toBe(true);
    expect(harness.server.getStatus().lastEdits[0].shrink).toBe(true);
  });
});
