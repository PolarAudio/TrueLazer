import React, { useCallback, useEffect, useRef, useState } from 'react';
import StudioCanvas from './StudioCanvas.jsx';
import {
  parsePinFromUrl,
  createClientId,
  streamUrl,
  fetchOutputs,
  patchOutput,
  lockOutput,
  nudgeRect,
  resizeRect,
} from './client.js';

function shortId(id) {
  if (!id) return '—';
  return String(id).slice(0, 8);
}

export default function App() {
  const [pin, setPin] = useState(() => parsePinFromUrl() || sessionStorage.getItem('companion-pin') || '');
  const [clientId] = useState(() => {
    try {
      return sessionStorage.getItem('companion-client-id') || (() => {
        const id = createClientId();
        sessionStorage.setItem('companion-client-id', id);
        return id;
      })();
    } catch {
      return createClientId();
    }
  });
  const [conn, setConn] = useState('disconnected'); // connecting|connected|disconnected
  const [outputsMap, setOutputsMap] = useState(() => new Map());
  const [selectedKey, setSelectedKey] = useState(null);
  const [selectedZoneIndex, setSelectedZoneIndex] = useState(null);
  const [locks, setLocks] = useState({});
  const [clientCount, setClientCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [pinDraft, setPinDraft] = useState('');
  const [nameDraft, setNameDraft] = useState(null);

  const pinRef = useRef(pin);
  const clientIdRef = useRef(clientId);
  const outputsRef = useRef(outputsMap);
  const locksRef = useRef(locks);
  const selectedKeyRef = useRef(selectedKey);
  const pendingRef = useRef(new Map()); // key -> { patch, timer }

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (showToast.t) clearTimeout(showToast.t);
    showToast.t = setTimeout(() => setToast(null), 4200);
  }, []);

  useEffect(() => { pinRef.current = pin; }, [pin]);
  useEffect(() => { outputsRef.current = outputsMap; }, [outputsMap]);
  useEffect(() => { locksRef.current = locks; }, [locks]);
  useEffect(() => { selectedKeyRef.current = selectedKey; }, [selectedKey]);

  const selected = selectedKey ? outputsMap.get(selectedKey) : null;
  const settings = selected?.settings || null;
  const lock = selectedKey ? locks[selectedKey] : null;
  const lockedByOther = !!(lock && lock.clientId !== clientId);
  const editable = !!selectedKey && conn === 'connected' && !lockedByOther;

  const refreshOutputs = useCallback(async () => {
    const p = pinRef.current;
    if (!p) return;
    try {
      const body = await fetchOutputs(p);
      const next = new Map();
      for (const o of body.outputs || []) next.set(o.key, { revision: o.revision, settings: o.settings });
      setOutputsMap(next);
      if (body.locks) setLocks(body.locks);
      if (typeof body.clientCount === 'number') setClientCount(body.clientCount);
      // Keep selection valid.
      setSelectedKey((cur) => {
        if (cur && next.has(cur)) return cur;
        const first = (body.outputs || [])[0];
        return first ? first.key : null;
      });
    } catch (e) {
      if (e.status === 401) {
        setConn('disconnected');
        showToast('Wrong PIN — check the 6 digits on the desktop.');
      } else {
        showToast(e.message || 'Could not load outputs.');
      }
    }
  }, [showToast]);

  // Initial load + SSE live sync.
  useEffect(() => {
    if (!pin) return;
    let cancelled = false;
    refreshOutputs();
    setConn('connecting');
    const es = new EventSource(streamUrl(pin, clientIdRef.current));
    const on = (name, handler) => es.addEventListener(name, handler);
    const off = (name, handler) => es.removeEventListener(name, handler);
    const handleConnected = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (!cancelled) {
          setConn('connected');
          if (d.locks) setLocks(d.locks);
          if (typeof d.clients === 'number') setClientCount(d.clients);
        }
      } catch { setConn('connected'); }
    };
    const handleSettings = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (!d?.key) return;
        setOutputsMap((prev) => {
          const next = new Map(prev);
          next.set(d.key, { revision: d.revision, settings: d.settings });
          return next;
        });
        // If someone else changed our output, drop stale selection gracefully.
        if (d.key === selectedKeyRef.current && d.clientId && d.clientId !== clientIdRef.current) {
          // Keep selection; canvas just redraws.
        }
      } catch {}
    };
    const handleClients = (e) => {
      try { setClientCount(JSON.parse(e.data).count ?? 0); } catch {}
    };
    const handleLocks = (e) => {
      try { setLocks(JSON.parse(e.data).locks || {}); } catch {}
    };
    on('connected', handleConnected);
    on('settings-changed', handleSettings);
    on('clients', handleClients);
    on('locks', handleLocks);
    es.onopen = () => { if (!cancelled) setConn((c) => (c === 'connecting' ? 'connected' : c)); };
    es.onerror = () => { if (!cancelled) setConn('disconnected'); };
    return () => {
      cancelled = true;
      off('connected', handleConnected);
      off('settings-changed', handleSettings);
      off('clients', handleClients);
      off('locks', handleLocks);
      es.close();
    };
  }, [pin, refreshOutputs]);

  const applyLocal = useCallback((key, revision, nextSettings) => {
    setOutputsMap((prev) => {
      const m = new Map(prev);
      m.set(key, { revision, settings: nextSettings });
      return m;
    });
  }, []);

  const ensureLock = useCallback(async (key) => {
    const cur = locksRef.current[key];
    if (cur && cur.clientId === clientIdRef.current) return true;
    if (cur && cur.clientId !== clientIdRef.current) {
      showToast(`Locked by ${shortId(cur.clientId)} — view only.`);
      return false;
    }
    try {
      const body = await lockOutput(pinRef.current, clientIdRef.current, key, 'acquire');
      if (body.locks) setLocks(body.locks);
      return true;
    } catch (e) {
      if (e.code === 'LOCKED') showToast(`Locked by ${shortId(e.owner)} — view only.`);
      else showToast(e.message || 'Lock failed.');
      refreshOutputs();
      return false;
    }
  }, [showToast, refreshOutputs]);

  const releaseLock = useCallback(async (key) => {
    if (!key) return;
    try {
      const body = await lockOutput(pinRef.current, clientIdRef.current, key, 'release');
      if (body.locks) setLocks(body.locks);
    } catch { /* TTL frees it anyway */ }
  }, []);

  const sendNow = useCallback(async (key, toSend) => {
    const p = pinRef.current;
    const entry = outputsRef.current.get(key);
    // Claim the lock on the way through (idempotent when already owned).
    const curLock = locksRef.current[key];
    if (!curLock) await ensureLock(key);
    // Optimistic local merge so the canvas drag tracks the thumb.
    const optimistic = entry ? { ...entry.settings, ...toSend } : toSend;
    if (entry) applyLocal(key, entry.revision, optimistic);
    setSaving(true);
    try {
      const res = await patchOutput(p, clientIdRef.current, key, toSend, entry?.revision);
      applyLocal(key, res.revision, res.settings);
      return true;
    } catch (e) {
      if (e.code === 'LOCKED') {
        showToast(`Locked by ${shortId(e.owner)} — change discarded.`);
        refreshOutputs();
      } else if (e.code === 'STALE_REVISION') {
        showToast('Changed elsewhere — refreshed.');
        refreshOutputs();
      } else if (e.status === 401) {
        showToast('PIN rejected — re-enter it.');
      } else {
        showToast(e.message || 'Save failed.');
        refreshOutputs();
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [applyLocal, ensureLock, refreshOutputs, showToast]);

  const schedulePatch = useCallback((key, partial, immediate = false) => {
    if (!key) return;
    const pending = pendingRef.current;
    const entry = pending.get(key) || { patch: {}, timer: null };
    entry.patch = { ...entry.patch, ...partial };
    pending.set(key, entry);
    const flush = () => {
      const e = pending.get(key);
      if (!e || !Object.keys(e.patch).length) return;
      const toSend = e.patch;
      e.patch = {};
      pending.set(key, e);
      if (e.timer) { clearTimeout(e.timer); e.timer = null; }
      sendNow(key, toSend);
    };
    if (immediate) flush();
    else {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(flush, 120);
    }
  }, [sendNow]);

  // Flush pending edits before unload (best effort).
  useEffect(() => {
    const flush = () => {
      for (const [key, entry] of pendingRef.current) {
        if (Object.keys(entry.patch).length) sendNow(key, entry.patch);
      }
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [sendNow]);

  // Release lock on output switch / unmount.
  const prevKeyRef = useRef(null);
  useEffect(() => {
    if (prevKeyRef.current && prevKeyRef.current !== selectedKey && locksRef.current[prevKeyRef.current]?.clientId === clientIdRef.current) {
      releaseLock(prevKeyRef.current);
    }
    prevKeyRef.current = selectedKey;
  }, [selectedKey, releaseLock]);

  useEffect(() => () => {
    const k = selectedKeyRef.current;
    if (k && locksRef.current[k]?.clientId === clientIdRef.current) releaseLock(k);
  }, [releaseLock]);

  const onSelectKey = (key) => {
    setSelectedKey(key);
    setSelectedZoneIndex(null);
    setNameDraft(null);
  };

  const onUpdateZone = useCallback((index, rect) => {
    const key = selectedKeyRef.current;
    if (!key) return;
    const entry = outputsRef.current.get(key);
    if (!entry) return;
    const zones = [...(entry.settings.safetyZones || [])];
    zones[index] = rect;
    schedulePatch(key, { safetyZones: zones });
  }, [schedulePatch]);

  const onUpdateArea = useCallback((rect) => {
    const key = selectedKeyRef.current;
    if (!key) return;
    schedulePatch(key, { outputArea: rect });
  }, [schedulePatch]);

  const onDragStart = useCallback(async () => {
    const key = selectedKeyRef.current;
    if (key) await ensureLock(key);
  }, [ensureLock]);

  const onDragCommit = useCallback(() => {
    const key = selectedKeyRef.current;
    const entry = key && pendingRef.current.get(key);
    if (entry && Object.keys(entry.patch).length) {
      const toSend = entry.patch;
      entry.patch = {};
      if (entry.timer) clearTimeout(entry.timer);
      sendNow(key, toSend);
    }
  }, [sendNow]);

  const toggle = (field) => {
    if (!editable || !selectedKey) return;
    schedulePatch(selectedKey, { [field]: !settings[field] }, true);
  };

  const setValue = (field, value) => {
    if (!editable || !selectedKey) return;
    schedulePatch(selectedKey, { [field]: value });
  };

  const addZone = () => {
    if (!editable || !selectedKey || !settings) return;
    const zones = [...(settings.safetyZones || []), { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }];
    setSelectedZoneIndex(zones.length - 1);
    schedulePatch(selectedKey, { safetyZones: zones }, true);
  };

  const deleteZone = () => {
    if (!editable || !selectedKey || selectedZoneIndex === null || !settings) return;
    const zones = (settings.safetyZones || []).filter((_, i) => i !== selectedZoneIndex);
    setSelectedZoneIndex(null);
    schedulePatch(selectedKey, { safetyZones: zones }, true);
  };

  const clearZones = () => {
    if (!editable || !selectedKey) return;
    setSelectedZoneIndex(null);
    schedulePatch(selectedKey, { safetyZones: [] }, true);
  };

  const nudgeSelected = (dx, dy) => {
    if (!editable || !selectedKey || selectedZoneIndex === null || !settings) return;
    const z = settings.safetyZones[selectedZoneIndex];
    if (!z) return;
    const zones = [...settings.safetyZones];
    zones[selectedZoneIndex] = nudgeRect(z, dx, dy);
    schedulePatch(selectedKey, { safetyZones: zones }, true);
  };

  const resizeSelected = (dw, dh) => {
    if (!editable || !selectedKey || selectedZoneIndex === null || !settings) return;
    const z = settings.safetyZones[selectedZoneIndex];
    if (!z) return;
    const zones = [...settings.safetyZones];
    zones[selectedZoneIndex] = resizeRect(z, dw, dh, 'se');
    schedulePatch(selectedKey, { safetyZones: zones }, true);
  };

  const submitPin = (e) => {
    e?.preventDefault();
    const p = pinDraft.trim();
    if (!/^[0-9]{6}$/.test(p)) { showToast('PIN is 6 digits.'); return; }
    sessionStorage.setItem('companion-pin', p);
    setPin(p);
  };

  // PIN gate.
  if (!pin) {
    return (
      <main className="companion gate">
        <h1>TrueLazer Zones</h1>
        <p className="muted">Enter the 6-digit PIN shown on the desktop to connect on this LAN.</p>
        <form onSubmit={submitPin} className="pin-form">
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="••••••"
            maxLength={6}
            value={pinDraft}
            onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, ''))}
            aria-label="PIN"
          />
          <button type="submit">Connect</button>
        </form>
        {toast && <div className="toast">{toast}</div>}
      </main>
    );
  }

  const outputs = [...outputsMap.entries()].map(([key, v]) => ({ key, ...v }));

  return (
    <main className="companion">
      <header className="companion-head">
        <div>
          <h1>TrueLazer Zones</h1>
          <div className="muted small">
            <span className={`dot ${conn}`} /> {conn} · {clientCount} device{clientCount === 1 ? '' : 's'}
            {selected && <> · r{selected.revision}</>}
            {saving && <> · saving…</>}
          </div>
        </div>
        <button className="link" onClick={() => { sessionStorage.setItem('companion-pin', ''); setPin(''); }}>Switch PIN</button>
      </header>

      {conn !== 'connected' && (
        <div className="banner warn">
          {conn === 'connecting' ? 'Connecting…' : 'Disconnected — the laser keeps its last zones. Reconnecting…'}
        </div>
      )}
      {lockedByOther && selectedKey && (
        <div className="banner lock">
          Locked by {shortId(lock.clientId)} <span className="muted">(view only)</span>
        </div>
      )}
      {!lockedByOther && lock && selectedKey && (
        <div className="banner mine">
          You’re editing this output
          <button className="link" onClick={() => releaseLock(selectedKey)} disabled={!editable}>Release</button>
        </div>
      )}

      {outputs.length > 0 ? (
        <div className="picker" role="tablist" aria-label="Outputs">
          {outputs.map((o) => {
            const l = locks[o.key];
            return (
              <button
                key={o.key}
                className={`chip ${o.key === selectedKey ? 'active' : ''}`}
                onClick={() => onSelectKey(o.key)}
                aria-selected={o.key === selectedKey}
              >
                🔒 {o.settings.name || o.key}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          {conn === 'connected' ? 'No outputs yet. Add a DAC on the desktop, then pull to refresh.' : 'Loading outputs…'}
          <button className="link" onClick={refreshOutputs}>Refresh</button>
        </div>
      )}

      {selected && settings && selectedKey && (
        <>
          <StudioCanvas
            settings={settings}
            selectedZoneIndex={selectedZoneIndex}
            onSelectZone={setSelectedZoneIndex}
            onUpdateZone={onUpdateZone}
            onUpdateArea={onUpdateArea}
            editable={editable}
            onDragStart={onDragStart}
            onDragCommit={onDragCommit}
          />

          <div className="toolbar">
            <button onClick={addZone} disabled={!editable}>＋ Zone</button>
            <button onClick={deleteZone} disabled={!editable || selectedZoneIndex === null}>Delete</button>
            <button onClick={clearZones} disabled={!editable}>Clear</button>
            <span className="spacer" />
            <span className="muted small">{(settings.safetyZones || []).length} zone(s)</span>
          </div>

          {selectedZoneIndex !== null && settings.safetyZones?.[selectedZoneIndex] && (
            <section className="card nudge">
              <h2>Zone {selectedZoneIndex + 1}</h2>
              <div className="nudge-grid">
                <span />
                <button onClick={() => nudgeSelected(0, -0.01)} disabled={!editable}>▲</button>
                <span />
                <button onClick={() => nudgeSelected(-0.01, 0)} disabled={!editable}>◀</button>
                <button onClick={() => nudgeSelected(0, 0.01)} disabled={!editable}>▼</button>
                <button onClick={() => nudgeSelected(0.01, 0)} disabled={!editable}>▶</button>
              </div>
              <div className="row wrap">
                <button className="small-btn" onClick={() => resizeSelected(0.01, 0)} disabled={!editable}>Wider</button>
                <button className="small-btn" onClick={() => resizeSelected(-0.01, 0)} disabled={!editable}>Narrower</button>
                <button className="small-btn" onClick={() => resizeSelected(0, 0.01)} disabled={!editable}>Taller</button>
                <button className="small-btn" onClick={() => resizeSelected(0, -0.01)} disabled={!editable}>Shorter</button>
                <span className="muted small mono">
                  {settings.safetyZones[selectedZoneIndex].x.toFixed(2)},{settings.safetyZones[selectedZoneIndex].y.toFixed(2)} ·
                  {settings.safetyZones[selectedZoneIndex].w.toFixed(2)}×{settings.safetyZones[selectedZoneIndex].h.toFixed(2)}
                </span>
              </div>
            </section>
          )}

          <section className="card controls">
            <h2>Output</h2>
            <div className="controls-grid">
              <Toggle label="Outlines" on={!!settings.zoneOutlineEnabled} onClick={() => toggle('zoneOutlineEnabled')} disabled={!editable} />
              <Toggle label="Show area" on={!!settings.transformationEnabled} onClick={() => toggle('transformationEnabled')} disabled={!editable} />
              <Toggle label="H-line" on={!!settings.testLineEnabled} onClick={() => toggle('testLineEnabled')} disabled={!editable} />
              <Toggle label="V-line" on={!!settings.verticalTestLineEnabled} onClick={() => toggle('verticalTestLineEnabled')} disabled={!editable} />
              <Toggle label="Flip X" on={!!settings.flipX} onClick={() => toggle('flipX')} disabled={!editable} />
              <Toggle label="Flip Y" on={!!settings.flipY} onClick={() => toggle('flipY')} disabled={!editable} />
            </div>
            <div className="mode">
              <span className="muted small">Area mode</span>
              <button className={settings.transformationMode === 'crop' ? 'on' : ''} disabled={!editable} onClick={() => setValue('transformationMode', 'crop')}>Crop</button>
              <button className={settings.transformationMode === 'scale' ? 'on' : ''} disabled={!editable} onClick={() => setValue('transformationMode', 'scale')}>Scale</button>
            </div>
            <label className="slider">
              <span>Dimmer <b>{Math.round((settings.dimmer ?? 1) * 100)}%</b></span>
              <input
                type="range" min={0} max={100} value={Math.round((settings.dimmer ?? 1) * 100)}
                disabled={!editable}
                onChange={(e) => setValue('dimmer', Number(e.target.value) / 100)}
              />
            </label>
            <label className="slider">
              <span>H-line Y <b>{typeof settings.testLineY === 'number' ? settings.testLineY.toFixed(2) : '0.50'}</b></span>
              <input
                type="range" min={0} max={100} value={Math.round((settings.testLineY ?? 0.5) * 100)}
                disabled={!editable || !settings.testLineEnabled}
                onChange={(e) => setValue('testLineY', Number(e.target.value) / 100)}
              />
            </label>
            <label className="slider">
              <span>V-line X <b>{typeof settings.testLineX === 'number' ? settings.testLineX.toFixed(2) : '0.50'}</b></span>
              <input
                type="range" min={0} max={100} value={Math.round((settings.testLineX ?? 0.5) * 100)}
                disabled={!editable || !settings.verticalTestLineEnabled}
                onChange={(e) => setValue('testLineX', Number(e.target.value) / 100)}
              />
            </label>
            <label className="name-field">
              <span className="muted small">Name</span>
              <div className="row">
                <input
                  value={nameDraft ?? (settings.name || '')}
                  disabled={!editable}
                  maxLength={64}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  onBlur={() => {
                    if (nameDraft === null) return;
                    const v = nameDraft;
                    setNameDraft(null);
                    if (v !== (settings.name || '')) schedulePatch(selectedKey, { name: v }, true);
                  }}
                />
              </div>
            </label>
          </section>

          <p className="muted small footnote">
            Drag red zones / blue area (when shown). Zones are beam-blanked — confirm on the laser from where you stand, not from the desk.
          </p>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function Toggle({ label, on, onClick, disabled }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={!!on}>
      {on ? '✓ ' : ''}{label}
    </button>
  );
}
