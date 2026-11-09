// Companion API helpers — pure + fetch wrappers shared by App.jsx.
// Kept dependency-free so the touch bundle stays small.

export function parsePinFromUrl(search = window.location.search) {
  try {
    const p = new URLSearchParams(search || '').get('pin');
    return /^[0-9]{6}$/.test(p || '') ? p : null;
  } catch {
    return null;
  }
}

export function parseClientIdFromUrl(search = window.location.search) {
  try {
    const id = new URLSearchParams(search || '').get('clientId');
    return /^[A-Za-z0-9_-]{1,64}$/.test(id || '') ? id : null;
  } catch {
    return null;
  }
}

export function createClientId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `phone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function streamUrl(pin, clientId) {
  const q = new URLSearchParams({ pin, clientId });
  return `/api/stream?${q.toString()}`;
}

export function outputsUrl(pin) {
  const q = new URLSearchParams({ pin });
  return `/api/outputs?${q.toString()}`;
}

export function outputUrl(key) {
  return `/api/outputs/${encodeURIComponent(key)}`;
}

const baseHeaders = (pin, clientId) => ({
  'Content-Type': 'application/json',
  'X-Companion-Pin': pin,
  ...(clientId ? { 'X-Client-Id': clientId } : {}),
});

export async function fetchOutputs(pin) {
  const res = await fetch(outputsUrl(pin), { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(body.error || `Outputs failed (${res.status})`);
    e.status = res.status;
    e.code = body.code || 'FETCH_FAILED';
    throw e;
  }
  return body;
}

export async function patchOutput(pin, clientId, key, patch, baseRevision) {
  const res = await fetch(outputUrl(key), {
    method: 'PATCH',
    headers: baseHeaders(pin, clientId),
    body: JSON.stringify({ patch, baseRevision, clientId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(body.error || `Patch failed (${res.status})`);
    e.status = res.status;
    e.code = body.code || 'PATCH_FAILED';
    e.owner = body.owner || null;
    e.revision = body.revision;
    throw e;
  }
  return body;
}

export async function lockOutput(pin, clientId, key, action = 'acquire') {
  const res = await fetch(`${outputUrl(key)}/lock`, {
    method: 'POST',
    headers: baseHeaders(pin, clientId),
    body: JSON.stringify({ clientId, action }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(body.error || `Lock failed (${res.status})`);
    e.status = res.status;
    e.code = body.code || 'LOCK_FAILED';
    e.owner = body.owner || null;
    throw e;
  }
  return body;
}

// --- Small pure rect helpers (mirrors server clamp + desktop drag) ---

export function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

export function round5(n) {
  return Math.round(n * 100000) / 100000;
}

export function nudgeRect(rect, dx, dy) {
  const w = Math.min(rect.w, 1);
  const h = Math.min(rect.h, 1);
  return {
    x: round5(clamp01(Math.min(rect.x + dx, 1 - w))),
    y: round5(clamp01(Math.min(rect.y + dy, 1 - h))),
    w: rect.w,
    h: rect.h,
  };
}

export function resizeRect(rect, dw, dh, anchor = 'se') {
  let { x, y, w, h } = rect;
  if (anchor.includes('w')) { x = rect.x - dw; w = rect.w + dw; }
  if (anchor.includes('e')) { w = rect.w + dw; }
  if (anchor.includes('n')) { y = rect.y - dh; h = rect.h + dh; }
  if (anchor.includes('s')) { h = rect.h + dh; }
  x = clamp01(x);
  y = clamp01(y);
  w = Math.min(Math.max(w, 0.01), 1 - x);
  h = Math.min(Math.max(h, 0.01), 1 - y);
  return { x: round5(x), y: round5(y), w: round5(w), h: round5(h) };
}

export function moveRect(rect, dx, dy) {
  return nudgeRect(rect, dx, dy);
}
