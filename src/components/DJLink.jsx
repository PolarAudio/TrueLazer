import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DJLINK_TRACK_MIME, deckDescriptorFromSnapshot } from '../utils/djLinkTracks';

const EMPTY = {
  connected: false,
  playerId: null,
  playing: false,
  seconds: 0,
  duration: null,
  title: null,
  artist: null,
  trackLoaded: false,
  // `trackId` is the link identity (matches the deck roster's key); `trackKey`
  // is the per-device artwork/metadata cache key. Both are kept — see
  // deckDescriptorFromStatus for why the distinction matters.
  trackId: null,
  trackKey: null,
  trackBPM: null,
  bpm: null,
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

const DJLink = ({ source = 'tap', onLinkSong }) => {
  // Both sources stay subscribed so flipping the selector shows the latest deck
  // state immediately instead of waiting for the next status packet.
  const [snapshots, setSnapshots] = useState({ prolink: EMPTY, stagelinq: EMPTY });
  const [artwork, setArtwork] = useState({});
  const [isDragging, setIsDragging] = useState(false);
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
          trackId: st.trackId != null ? String(st.trackId) : prev[src].trackId,
          trackKey: st.trackKey != null ? st.trackKey : prev[src].trackKey,
          trackBPM: st.trackBPM != null ? st.trackBPM : prev[src].trackBPM,
          bpm: st.bpm != null ? st.bpm : prev[src].bpm,
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

  // Which deck the drag / click will link, and which deck the readout shows.
  //
  // Deliberately INDEPENDENT of `bpmSource`. `bpmSource` picks which deck drives
  // the show tempo; it has nothing to do with which deck has a song the operator
  // wants to bind to a clip. Gating the drag handle on it meant that with the
  // default 'tap' source the field was `draggable={false}`, and Chromium
  // silently fell back to a text drag that dropped nowhere.
  //
  // So: prefer the displayed protocol, then fall back to any other protocol that
  // is actually reporting a loaded track. With 'tap' / 'tcnet' there is no
  // displayed protocol at all, so BOTH are candidates.
  const descriptorFor = (src) => (src ? deckDescriptorFromSnapshot(src, snapshots[src] || EMPTY) : null);
  const alternates = link
    ? [link === 'prolink' ? 'stagelinq' : 'prolink']
    : ['prolink', 'stagelinq'];

  const preferredDeck = descriptorFor(link);
  let linkDeck = preferredDeck && preferredDeck.loaded ? preferredDeck : null;
  let linkIsOtherSource = false;
  if (!linkDeck) {
    for (const src of alternates) {
      const d = descriptorFor(src);
      if (d && d.loaded) {
        linkDeck = d;
        linkIsOtherSource = true;
        break;
      }
    }
  }
  const canLink = !!linkDeck;

  // Show whichever deck we would link. With 'tap' selected but a CDJ on the
  // network, the operator still needs to SEE the song in order to drag it — the
  // BPM selector must not hide the deck that is right there.
  const displaySource = linkDeck ? linkDeck.source : link;
  const s = displaySource ? (snapshots[displaySource] || EMPTY) : EMPTY;
  const coverKey = displaySource && s.trackKey ? `${displaySource}|${s.trackKey}` : null;
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

  const state = !displaySource ? 'off'
    : !s.connected ? 'off'
      : !s.trackLoaded ? 'empty'
        : s.playing ? 'playing' : 'paused';
  const stateLabel = state === 'off' ? 'No deck'
    : state === 'empty' ? 'No track'
      : s.playing ? 'Playing' : 'Paused';
  const timeText = !displaySource ? '--:--'
    : s.duration ? `${formatTime(s.seconds)} / ${formatTime(s.duration)}` : formatTime(s.seconds);

  const deckColor = deckColorToCss(s.deckColor);

  // Drag the song info onto a clip to bind that clip to this track. The
  // descriptor is captured HERE, at drag start, not read from the live snapshot
  // on drop — the deck can load the next track while the operator is dragging.
  const handleDragStart = useCallback((e) => {
    if (!canLink) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(DJLINK_TRACK_MIME, JSON.stringify(linkDeck));
    // text/plain so the payload survives a drop outside the app (a text editor
    // gets "Title — Artist", which is also what a DJ would paste into a search).
    e.dataTransfer.setData('text/plain',
      [linkDeck.title, linkDeck.artist].filter(Boolean).join(' — ') || String(linkDeck.trackId));
    // 'copyLink', NOT 'copy'. The clip drop target sets dropEffect='link' for a
    // song payload (it binds a track rather than replacing content), and per the
    // drag-and-drop spec a dropEffect the source did not allow is REFUSED — the
    // `drop` event never fires, with no error anywhere. 'copy' alone permitted
    // only 'copy', so every song drop was silently rejected.
    e.dataTransfer.effectAllowed = 'copyLink';
    setIsDragging(true);

  }, [canLink, linkDeck]);

  const handleDragEnd = useCallback(() => setIsDragging(false), []);

  // Click route. With a clip already selected, clicking the song links the two.
  const handleClick = useCallback(() => {
    if (onLinkSong && linkDeck) onLinkSong(linkDeck);
  }, [onLinkSong, linkDeck]);

  const protocolName = (src) => (src === 'stagelinq' ? 'StageLinq' : 'Pro DJ Link');
  const linkLabel = linkDeck ? `${protocolName(linkDeck.source)} deck ${linkDeck.deckId}` : null;

  const fieldTitle = canLink
    ? `Drag onto a clip to bind it to "${linkDeck.title || linkDeck.trackId}"` +
    (linkIsOtherSource
      ? ` — from the ${linkLabel}${link ? ' (not the BPM source)' : ''}`
      : '') +
    '. Or just click to link the selected clip.'
    : 'No deck is reporting a loaded track, so there is nothing to link yet. ' +
    'Start a Pro DJ Link or StageLinq listener (Link/Sync Settings) and load a track.';

  return (
    <div className={`link-display ${isDragging ? 'dragging' : ''}`}>
      <div className="link-channel">
        <span className="link-source-tag">{displaySource ? (displaySource === 'prolink' ? 'ProDJ' : 'StLinq') : '—'}</span>
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
      {/* The song information field is BOTH the drag handle and a click target
          for song linking. */}
      <div
        className={`link-track-info ${canLink ? 'linkable' : 'not-linkable'} ${linkIsOtherSource ? 'link-other-source' : ''}`}
        draggable={canLink}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
        role={canLink ? 'button' : undefined}
        tabIndex={canLink ? 0 : undefined}
        onKeyDown={canLink ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } } : undefined}
        title={fieldTitle}
      >
        <div className="link-title">{s.title || '—'}</div>
        <div className="link-artist">{s.artist || '—'}</div>
      </div>
    </div>
  );
};

export default DJLink;
