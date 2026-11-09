import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';

// Desktop control panel for the Laser Zone Tool (Step 3). Polls the
// companion server status so the operator always sees PIN, URL, QR,
// locks and the shrink audit trail while the window is open.
export default function CompanionSettingsSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [qr, setQr] = useState(null); // { url, dataUrl, error }
  const [selectedLan, setSelectedLan] = useState(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.companionStatus) return;
    try {
      const s = await api.companionStatus();
      if (!aliveRef.current) return;
      setStatus(s);
      if (s?.lan?.length && !selectedLan) setSelectedLan(s.lan[0].address);
    } catch { /* keep last status */ }
  }, [selectedLan]);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    const id = setInterval(refresh, 2000);
    return () => { aliveRef.current = false; clearInterval(id); };
  }, [refresh]);

  const loadQr = useCallback(async (address) => {
    const api = window.electronAPI;
    if (!api?.companionQr) return;
    try {
      const r = await api.companionQr(address || selectedLan);
      if (aliveRef.current) setQr(r?.ok ? r : { url: r?.url || '', error: r?.error || t('companion.qrMissing') });
    } catch {
      if (aliveRef.current) setQr({ url: '', error: t('companion.qrMissing') });
    }
  }, [selectedLan, t]);

  useEffect(() => {
    if (status?.running) loadQr(selectedLan);
    else setQr(null);
  }, [status?.running, status?.pin, selectedLan, loadQr]);

  const toggle = async () => {
    const api = window.electronAPI;
    if (!api) return;
    setBusy(true);
    try {
      if (status?.running) {
        await api.companionStop();
        setQr(null);
      } else {
        await api.companionStart();
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    const api = window.electronAPI;
    if (!api?.companionRotatePin) return;
    setBusy(true);
    try {
      await api.companionRotatePin();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text) => {
    const api = window.electronAPI;
    try {
      if (api?.copyToClipboard) await api.copyToClipboard(text);
      else await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(''), 1500);
    } catch { /* manual copy fallback */ }
  };

  const running = !!status?.running;
  const lan = status?.lan || [];
  const urlFor = (addr) => `http://${addr || '127.0.0.1'}:${status?.port || 5180}/?pin=${status?.pin || '••••••'}`;
  const locks = status?.locks || {};
  const lockEntries = Object.entries(locks);
  const edits = status?.lastEdits || [];

  return (
    <div className="general-settings-section" style={{ marginTop: '16px' }}>
      <h4 style={{ marginBottom: '10px', fontSize: '13px' }}>{t('companion.title')}</h4>
      <p style={{ fontSize: '11px', color: '#999', marginTop: 0 }}>{t('companion.blurb')}</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <button
          onClick={toggle}
          disabled={busy}
          style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #555', background: running ? '#5a2323' : '#1f4d2e', color: '#fff', cursor: 'pointer', fontSize: '12px', minWidth: '120px' }}
        >
          {running ? t('companion.disable') : t('companion.enable')}
        </button>
        <span style={{ fontSize: '11px', color: running ? '#7dff9a' : '#888' }}>
          ● {running ? t('companion.running') : t('companion.stopped')} · {status?.clients ?? 0} {t('companion.clients')}
        </span>
      </div>

      {running && (
        <>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0, textAlign: 'center' }}>
              {qr?.dataUrl ? (
                <img src={qr.dataUrl} alt="Companion QR" width={140} height={140} style={{ background: '#fff', padding: '6px', borderRadius: '6px', display: 'block' }} />
              ) : (
                <div style={{ width: 140, height: 140, border: '1px dashed #555', borderRadius: '6px', display: 'grid', placeItems: 'center', fontSize: '10px', color: '#888', padding: '8px' }}>
                  {qr?.error || t('companion.scanQR')}
                </div>
              )}
              <div style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>{t('companion.scanQR')}</div>
              {status?.mdns?.service && (
                <div style={{ fontSize: '9px', color: '#666', marginTop: '2px' }} title={status.mdns.instance}>
                  {t('companion.mdns')}: {status.mdns.service}
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '11px', color: '#888' }}>{t('companion.pin')}</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <strong style={{ fontSize: '28px', letterSpacing: '6px', fontVariantNumeric: 'tabular-nums' }}>{status.pin}</strong>
                <button onClick={rotate} disabled={busy} style={{ padding: '4px 8px', background: '#333', border: '1px solid #555', color: '#ccc', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}>
                  {t('companion.rotate')}
                </button>
              </div>
              <p style={{ fontSize: '9px', color: '#666', margin: '4px 0' }}>{t('companion.pinHint')}</p>

              <div style={{ fontSize: '11px', color: '#888', marginTop: '8px' }}>{t('companion.network')}</div>
              {lan.length > 0 ? (
                <select
                  value={selectedLan || lan[0]?.address || ''}
                  onChange={(e) => setSelectedLan(e.target.value)}
                  style={{ width: '100%', fontSize: '11px', marginBottom: '6px', background: '#2a2a2a', color: '#eee', border: '1px solid #444', borderRadius: '3px', padding: '4px' }}
                >
                  {lan.map((l) => (
                    <option key={l.address} value={l.address}>
                      {l.name} ({l.address})
                    </option>
                  ))}
                </select>
              ) : null}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <code style={{ flex: 1, fontSize: '11px', color: '#eee', wordBreak: 'break-all' }}>{urlFor(selectedLan)}</code>
                <button onClick={() => copy(urlFor(selectedLan))} style={{ padding: '4px 10px', background: '#333', border: '1px solid #555', color: '#ccc', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}>
                  {copied === urlFor(selectedLan) ? t('companion.copied') : t('companion.copy')}
                </button>
              </div>

              <div style={{ fontSize: '11px', color: '#888', marginTop: '10px' }}>{t('companion.locks')}</div>
              {lockEntries.length === 0 ? (
                <div style={{ fontSize: '11px', color: '#aaa' }}>{t('companion.noLocks')}</div>
              ) : (
                <ul style={{ margin: '4px 0', paddingLeft: '16px', fontSize: '11px', color: '#eee' }}>
                  {lockEntries.map(([key, rec]) => (
                    <li key={key}>{key} — {String(rec.clientId).slice(0, 8)}</li>
                  ))}
                </ul>
              )}

              <div style={{ fontSize: '11px', color: '#888', marginTop: '10px' }}>{t('companion.audit')}</div>
              {edits.length === 0 ? (
                <div style={{ fontSize: '11px', color: '#aaa' }}>{t('companion.noEdits')}</div>
              ) : (
                <ul style={{ margin: '4px 0', paddingLeft: '16px', fontSize: '11px' }}>
                  {edits.slice(0, 10).map((e, i) => (
                    <li key={`${e.at}-${i}`} style={{ color: e.shrink ? '#ffd400' : '#eee' }}>
                      {e.shrink ? `⚠ ${t('companion.shrink')} — ` : ''}
                      {e.key} · {e.clientId.slice(0, 8)} · {new Date(e.at).toLocaleTimeString()} · r{e.revision}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <p style={{ fontSize: '9px', color: '#666', marginTop: '10px' }}>{t('companion.firewall')}</p>
        </>
      )}
    </div>
  );
}
