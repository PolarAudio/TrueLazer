import React, { useEffect, useRef, useState } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import { linkedClipDurationSec, withLinkDefaults } from '../utils/djLinkTracks';

const deckColorToCss = (raw) => {
  if (typeof raw !== 'string') return null;
  const hex = raw.trim().replace(/^#/, '');
  if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(2)}`;
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`;
  return null;
};

const formatClock = (sec) => {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '--:--';
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
};

/** `m:ss` -> seconds, or null when the field is empty / not a time. */
const parseClock = (text) => {
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':').map((p) => p.trim());
  if (parts.some((p) => p === '' || !Number.isFinite(Number(p)))) return null;
  const nums = parts.map(Number);
  if (nums.length === 1) return nums[0];
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
};

/**
 * Text field for a time value that keeps the operator's literal text while they
 * type. Committing a parsed number on every keystroke makes "1:" impossible to
 * type (it reformats to "0:01" under the cursor), so the draft is local state
 * and only a valid value is pushed up.
 */
const ClockField = ({ value, onCommit, disabled, ariaLabel }) => {
  const [draft, setDraft] = useState(() => formatClock(value));
  const [focused, setFocused] = useState(false);
  const lastPushed = useRef(value);

  useEffect(() => {
    if (focused) return;
    if (value === lastPushed.current) return;
    lastPushed.current = value;
    setDraft(formatClock(value));
  }, [value, focused]);

  const commit = (text) => {
    const parsed = parseClock(text);
    if (parsed == null || parsed < 0) return;
    lastPushed.current = parsed;
    onCommit(parsed);
  };

  return (
    <input
      type="text"
      className="djlink-time-input"
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder="0:00"
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        setFocused(false);
        commit(e.target.value);
        setDraft(formatClock(lastPushed.current));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit(e.currentTarget.value);
          setDraft(formatClock(lastPushed.current));
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(formatClock(lastPushed.current));
          e.currentTarget.blur();
        }
      }}
    />
  );
};

const BAR_OPTIONS = [1, 2, 4, 8, 16, 32];

/**
 * "Not driven" on its own is a dead end — an unarmed transport, a deck that has
 * not loaded the track, a disabled link and a play-trigger waiting for PLAY all
 * look identical. The engine reports which one it is; say it here.
 */
const NOT_DRIVEN_REASONS = {
  'transport-disarmed': 'not driven — Clip Transport is disarmed',
  'no-link': 'not driven — this clip has no song link',
  'link-disabled': 'not driven — this link is switched off',
  'no-decks': 'not driven — no deck is reporting',
  'track-not-loaded': 'not driven — that song is not loaded in a deck',
  'waiting-for-play': 'armed — waiting for the deck to start',
  'not-matching': 'armed — deck not seen yet',
};

/**
 * DJ-Link Clip Transport — per-clip transport configuration.
 *
 * A linked clip's timebase is the DJ deck, not the clip's own Clip Playback
 * settings. This panel owns the link itself (which song), the trigger edge, the
 * two follow modes, and the live readout that proves the deck is driving it.
 */
const ClipDjLinkSettings = ({
  link: rawLink,
  onUpdate,
  onUnlink,
  uiState,
  onUpdateUiState,
  clock,
  transportArmed,
  onArmTransport,
}) => {
  const link = withLinkDefaults(rawLink);
  const collapsedPanels = uiState?.collapsedPanels || {};
  const deck = clock?.deck || null;
  const live = !!(clock && clock.active);

  const handleToggle = (val) => {
    if (onUpdateUiState) onUpdateUiState({ collapsedPanels: { djlink: val } });
  };

  // Guard FIRST. Most clips have no song binding, so every link-derived value
  // below has to come after this — reading `link.follow` on an unlinked clip
  // threw for the whole panel.
  if (!link) {
    return (
      <CollapsiblePanel title="DJ-Link Transport" isCollapsed={!!collapsedPanels['djlink']} onToggle={handleToggle}>
        <div className="djlink-empty">
          <strong>No song linked to this clip yet.</strong>
          <ol>
            <li>Load a track on a DJ deck (Pro DJ Link or StageLinq) — the song appears in the DJ-Link display in the middle bar, right.</li>
            <li>Drag that song onto this clip&hellip; or select this clip and just <em>click</em> the song.</li>
            <li>Arm <em>Clip Transport</em> in Link/Sync Settings so linked clips actually fire.</li>
          </ol>
        </div>
      </CollapsiblePanel>
    );
  }

  const isLoop = link.follow === 'loop';
  const dot = deckColorToCss(link.deckColor) || deckColorToCss(deck?.deckColor);
  const loopBeats = Number.isFinite(link.loopBeats) && link.loopBeats > 0 ? link.loopBeats : 8;
  const passDuration = linkedClipDurationSec(link, deck);
  const fullDuration = (link.trackDurationMs || 0) / 1000;

  return (
    <CollapsiblePanel title="DJ-Link Transport" isCollapsed={!!collapsedPanels['djlink']} onToggle={handleToggle}>
      <div className="djlink-head">
        <span className={`djlink-dot ${live ? 'live' : ''}`} style={dot ? { background: dot, boxShadow: `0 0 6px ${dot}` } : undefined} />
        <div className="djlink-head-text">
          <div className="djlink-title" title={link.title || link.trackId}>{link.title || link.trackId}</div>
          <div className="djlink-sub">
            {[link.artist, link.source === 'stagelinq' ? 'StageLinq' : 'Pro DJ Link'].filter(Boolean).join(' — ')}
          </div>
        </div>
        <button className="small-btn djlink-unlink" onClick={onUnlink} title="Remove this song link">Unlink</button>
      </div>

      {!transportArmed && (
        <div className="djlink-warn">
          Clip Transport is disarmed in Link/Sync Settings — this link will not fire.{' '}
          <button className="small-btn" onClick={onArmTransport}>Arm it</button>
        </div>
      )}

      <div className="control-group">
        <label>Enabled</label>
        <div className="radio-group" style={{ display: 'flex', gap: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
            <input type="radio" checked={link.enabled} onChange={() => onUpdate({ enabled: true })} /> On
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
            <input type="radio" checked={!link.enabled} onChange={() => onUpdate({ enabled: false })} /> Off
          </label>
        </div>
      </div>

      <div className="control-group">
        <label>Trigger</label>
        <div className="radio-group" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <label title="Fire as soon as the track is cued in a deck" style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
            <input type="radio" checked={link.trigger === 'load'} onChange={() => onUpdate({ trigger: 'load' })} /> On Load
          </label>
          <label title="Wait until the deck is actually rolling" style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
            <input type="radio" checked={link.trigger === 'play'} onChange={() => onUpdate({ trigger: 'play' })} /> On Play
          </label>
        </div>
      </div>

      <div className="control-group">
        <label>Follow</label>
        <div className="playback-mode-selector">
          <button
            className={isLoop ? 'button_inactive' : 'active'}
            onClick={() => onUpdate({ follow: 'position' })}
            title="The clip covers the trim window; the deck's playhead scrubs the animation"
          >Deck Position</button>
          <button
            className={isLoop ? 'active' : 'button_inactive'}
            onClick={() => onUpdate({ follow: 'loop' })}
            title="The clip loops for the whole track, phase-locked to the deck's beat"
          >Loop</button>
        </div>
      </div>

      {isLoop ? (
        <>
          <div className="control-group">
            <label>Loop Length (beats)</label>
            <div className="value-adjuster">
              <button onClick={() => onUpdate({ loopBeats: Math.max(1, loopBeats - 1) })}>-1</button>
              <input
                type="number"
                min="1"
                value={loopBeats}
                onChange={(e) => onUpdate({ loopBeats: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              />
              <button onClick={() => onUpdate({ loopBeats: loopBeats + 1 })}>+1</button>
              <button onClick={() => onUpdate({ loopBeats: loopBeats / 2 })}>/2</button>
              <button onClick={() => onUpdate({ loopBeats: loopBeats * 2 })}>*2</button>
            </div>
            <div className="djlink-hint">
              {passDuration.toFixed(2)}s per loop
              {deck && deck.bpm > 0 ? ` at ${Math.round(deck.bpm)} BPM` : ' (deck tempo unknown)'}
            </div>
          </div>
          <div className="control-group">
            <label>Snap to bars</label>
            <div className="radio-group" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {BAR_OPTIONS.map((n) => (
                <button
                  key={n}
                  className={`small-btn ${loopBeats === n * 4 ? 'active' : ''}`}
                  onClick={() => onUpdate({ loopBeats: n * 4 })}
                  title={`${n * 4} beats = ${n} bar${n > 1 ? 's' : ''} in 4/4`}
                >{n}</button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="control-group">
            <label>Window</label>
            <div className="djlink-window">
              <ClockField
                value={link.startSec || 0}
                onCommit={(v) => onUpdate({ startSec: v })}
                ariaLabel="Window start"
              />
              <span className="djlink-dash">to</span>
              <ClockField
                value={link.endSec || 0}
                onCommit={(v) => onUpdate({ endSec: v })}
                ariaLabel="Window end"
              />
            </div>
            <div className="djlink-hint">
              {link.endSec > link.startSec
                ? `${formatClock(link.endSec - link.startSec)} of animation across this part of the track`
                : `Whole track (${formatClock(fullDuration)}) — 0:00 to 0:00 means "all of it"`}
            </div>
          </div>
        </>
      )}

      <div className="control-group">
        <label title="Jogging the deck backward plays the clip backward">
          <input
            type="checkbox"
            checked={link.followDirection !== false}
            onChange={(e) => onUpdate({ followDirection: e.target.checked })}
          />{' '}
          Follow deck direction
        </label>
      </div>

      <div className="djlink-readout">
        <div className="djlink-readout-row">
          <span className="djlink-readout-label">Deck</span>
          <span className="djlink-readout-value">
            {deck ? `${formatClock(clock.positionSec)}${deck.trackDurationMs ? ` / ${formatClock(deck.trackDurationMs / 1000)}` : ''}` : '—'}
            {deck && clock.direction !== 0 ? <span className="djlink-arrow">{clock.direction > 0 ? '▶' : '◀'}</span> : null}
            {deck && clock.direction !== 0 ? <span className="djlink-dir-label">{clock.direction > 0 ? 'forward' : 'backward'}</span> : null}
          </span>
        </div>
        <div className="djlink-readout-row">
          <span className="djlink-readout-label">Clip</span>
          <span className="djlink-readout-value">
            {live
              ? `${(clock.progress * 100).toFixed(1)}%${deck && deck.bpm > 0 ? ` • ${Math.round(deck.bpm)} BPM` : ''}`
              : NOT_DRIVEN_REASONS[clock?.reason] || 'not driven'}
          </span>
        </div>
        <div className="djlink-progress">
          <div
            className={`djlink-progress-fill ${live ? 'live' : ''}`}
            style={{ width: `${live ? clock.progress * 100 : 0}%`, background: dot || undefined }}
          />
        </div>
      </div>
    </CollapsiblePanel>
  );
};

export default React.memo(ClipDjLinkSettings);
