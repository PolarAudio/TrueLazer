import React, { useEffect, useRef, useState } from 'react';

const EMPTY = {
  connected: false,
  playerId: null,
  playing: false,
  seconds: 0,
  duration: null,
  title: null,
  artist: null,
  trackLoaded: false,
  trackKey: null,
  deckColor: null,
};

const formatTime = (sec) => {
  if (sec == null || !isFinite(sec) || sec < 0) return '--:--';
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
};

// The BPM/link source is the single selector for the whole link feature, so the
// display follows it rather than carrying its own picker: 'prolink' shows the
// Pioneer deck, 'stagelinq' the Denon deck. Tap tempo and TCNet are not DJ-Link
// metadata sources, so they show the idle state.
const LINK_FOR_SOURCE = { prolink: 'prolink', stagelinq: 'stagelinq' };

// Denon reports the assigned deck colour as "#AARRGGBB" (e.g. #ffea2828 = opaque
// red). CSS wants #RRGGBB, so drop the leading alpha pair. Anything unrecognised
// is rejected so a malformed value can never produce an invalid colour.
const deckColorToCss = (raw) => {
  if (typeof raw !== 'string') return null;
  const hex = raw.trim().replace(/^#/, '');
  if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(2)}`;
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`;
  return null;
};

// 16x16 glyphs matching the transport buttons, so status reads at a glance.
const ICON_PLAY = 'm11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393';
const ICON_PAUSE = 'M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 14 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5';
const ICON_STOP = 'M5 3.5h6A1.5 1.5 0 0 1 12.5 5v6a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 11V5A1.5 1.5 0 0 1 5 3.5';
const ICON_NOTE = 'M14 3.5v8.74a2.5 2.5 0 1 1-1.5-2.24V6.6L7 8.1v6.65a2.5 2.5 0 1 1-1.5-2.24V5.5a.75.75 0 0 1 .57-.73l6.5-1.85a.75.75 0 0 1 1.43.58';

const StatusIcon = ({ kind }) => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d={kind === 'playing' ? ICON_PLAY : kind === 'paused' ? ICON_PAUSE : ICON_STOP} />
  </svg>
);

const DJLink = ({ source = 'tap' }) => {
  // Both sources stay subscribed so flipping the selector shows the latest deck
  // state immediately instead of waiting for the next status packet.
  const [snapshots, setSnapshots] = useState({ prolink: EMPTY, stagelinq: EMPTY });
  const [artwork, setArtwork] = useState({});
  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const patch = (src) => (st) => {
      if (!st) return;
      setSnapshots((prev) => ({
        ...prev,
        [src]: {
          ...prev[src],
          connected: true,
          playerId: st.playerId != null ? String(st.playerId) : prev[src].playerId,
          playing: !!(st.playState === 3 || st.playState === true || st.playState === 4),
          seconds: typeof st.seconds === 'number' ? st.seconds : prev[src].seconds,
          duration: typeof st.trackDuration === 'number' && st.trackDuration > 0
            ? st.trackDuration / 1000
            : prev[src].duration,
          title: st.trackTitle != null ? st.trackTitle : prev[src].title,
          artist: st.trackArtist != null ? st.trackArtist : prev[src].artist,
          trackLoaded: st.trackLoaded != null ? !!st.trackLoaded : prev[src].trackLoaded,
          trackKey: st.trackKey != null ? st.trackKey : prev[src].trackKey,
          deckColor: st.deckColor != null ? st.deckColor : prev[src].deckColor,
        },
      }));
    };

    const offProlink = api.onProlinkState ? api.onProlinkState(patch('prolink')) : null;
    const offStagelinq = api.onStagelinqState ? api.onStagelinqState(patch('stagelinq')) : null;
    const offArtwork = api.onDjLinkArtwork
      ? api.onDjLinkArtwork((a) => {
        if (!a || !a.trackKey || !a.dataUrl) return;
        setArtwork((prev) => ({ ...prev, [`${a.source}|${a.trackKey}`]: a.dataUrl }));
      })
      : null;
    return () => {
      if (offProlink) offProlink();
      if (offStagelinq) offStagelinq();
      if (offArtwork) offArtwork();
    };
  }, []);

  const link = LINK_FOR_SOURCE[source] || null;
  const s = link ? (snapshots[link] || EMPTY) : EMPTY;
  const coverKey = link && s.trackKey ? `${link}|${s.trackKey}` : null;
  const cover = coverKey ? artwork[coverKey] : null;

  // The main process pushes artwork once per track, so a reload or a late mount
  // misses it. Pull whatever it already holds whenever the shown track changes.
  useEffect(() => {
    if (!coverKey || artwork[coverKey]) return;
    const api = window.electronAPI;
    if (!api || !api.getDjLinkArtwork) return;
    let cancelled = false;
    api.getDjLinkArtwork().then((all) => {
      if (cancelled || !all) return;
      setArtwork((prev) => ({ ...prev, ...all }));
    }).catch(() => { });
    return () => { cancelled = true; };
  }, [coverKey, artwork]);

  const state = !link ? 'off'
    : !s.connected ? 'off'
      : !s.trackLoaded ? 'empty'
        : s.playing ? 'playing' : 'paused';
  const stateLabel = state === 'off' ? 'No link method'
    : state === 'empty' ? 'No track'
      : s.playing ? 'Playing' : 'Paused';
  const timeText = !link ? '--:--'
    : s.duration ? `${formatTime(s.seconds)} / ${formatTime(s.duration)}` : formatTime(s.seconds);

  const deckColor = deckColorToCss(s.deckColor);
  return (
    <div className="link-display">
      <div className="link-channel">
        <span className="link-source-tag">{link ? (link === 'prolink' ? 'ProDJ' : 'StLinq') : '—'}</span>
        <span className="link-player-id" style={deckColor ? { color: deckColor } : undefined}>
          {s.playerId || '—'}
        </span>
      </div>
      <div className={`link-status ${state}`} title={stateLabel}>
        <StatusIcon kind={state === 'playing' ? 'playing' : state === 'paused' ? 'paused' : 'stop'} />
      </div>
      <div className="link-time">{timeText}</div>
      <div
        className={`link-cover ${cover ? 'has-art' : ''}`}
        style={cover ? { backgroundImage: `url(${cover})` } : undefined}
        title={cover ? '' : 'No cover art available from this player'}
      >
        {!cover && (
          <svg className="link-cover-placeholder" viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d={ICON_NOTE} />
          </svg>
        )}
      </div>
      <div className="link-title" title={s.title || ''}>{s.title || '—'}</div>
      <div className="link-artist" title={s.artist || ''}>{s.artist || '—'}</div>
    </div>
  );
};

export default DJLink;
