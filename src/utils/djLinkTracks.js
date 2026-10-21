/**
 * DJ-Link Clip Transport — pure logic.
 *
 * Everything here is deliberately free of React and of the app's playback
 * internals so the deck->clip mapping can be reasoned about (and unit tested)
 * on its own. The consumer is `useDjLinkClipTransport`, which owns the timers
 * and the side effects (activation / deactivation) and only calls in here for
 * the decisions.
 *
 * A "link" is the `djLink` field stored on a clip:
 *
 *   {
 *     enabled, source, trackId, trackKey, title, artist, deckColor,
 *     trackDurationMs, linkedAt,
 *     trigger,          // 'load' | 'play'
 *     follow,           // 'position' | 'loop'
 *     startSec, endSec, // position mode trim window (0/0 = whole track)
 *     loopBeats,        // loop mode length
 *     followDirection,  // follow the deck's play direction
 *   }
 */

/** Custom drag MIME. `application/json` is already taken by effects, DACs and
 *  generators, so a link drop has to be distinguishable in the payload. */
export const DJLINK_TRACK_MIME = 'application/x-truelazer-djlink-track';

/** Default transport config for a freshly dropped link. */
export const DEFAULT_DJ_LINK = Object.freeze({
  enabled: true,
  trigger: 'load',
  follow: 'loop',
  startSec: 0,
  endSec: 0,
  loopBeats: 8,
  followDirection: true,
});

/**
 * Position deltas below this are packet jitter, not a reverse play. Without a
 * deadband a paused deck (whose playhead is reported from a beat ramp that
 * wobbles) flips direction constantly and a linked clip flickers between
 * forward and backward every few frames.
 */
export const DIRECTION_DEADBAND_SEC = 0.05;

/** True when a deck descriptor identifies a real loaded track. */
export const isDeckLoaded = (deck) =>
  !!(deck && deck.loaded && typeof deck.trackId === 'string' && deck.trackId.length > 0);

/**
 * Build the link payload written onto a clip from a deck descriptor. Called
 * from the drag/drop handler, so it must tolerate a partial descriptor (a deck
 * that has not reported its metadata yet still has a usable trackId).
 */
export function makeLinkFromDeck(deck) {
  if (!isDeckLoaded(deck)) return null;
  return {
    ...DEFAULT_DJ_LINK,
    source: deck.source,
    trackId: deck.trackId,
    trackKey: deck.trackKey || null,
    title: deck.title || null,
    artist: deck.artist || null,
    deckColor: deck.deckColor || null,
    trackDurationMs: typeof deck.trackDurationMs === 'number' ? deck.trackDurationMs : null,
    linkedAt: Date.now(),
  };
}

/**
 * Build the deck descriptor that gets dragged onto a clip, from the DJ-Link
 * display's normalised snapshot for one protocol.
 *
 * The identity that matters is `trackId`, and it MUST be the packet's own
 * `trackId` — the same value the deck roster uses to index decks. The
 * `trackKey` is a per-device cache key (`deviceId:slot:trackId` on Pro DJ Link,
 * `deviceId|networkPath` on StageLinq) and is carried alongside for display
 * only; using it as the link identity would produce links that can never match a
 * deck. `rosterToDeckMap` keys on trackId for exactly this reason.
 */
export function deckDescriptorFromSnapshot(source, snap) {
  if (!snap) return null;
  // Same guard as deckDescriptorFromStatus: the display snapshot stringifies the
  // id too, so "0" must not become a link identity.
  const rawId = snap.trackId;
  const usable = (typeof rawId === 'number' && rawId > 0)
    || (typeof rawId === 'string' && rawId.length > 0);
  if (!usable) return null;
  const trackId = String(rawId);
  return {
    source,
    deckId: snap.playerId != null ? String(snap.playerId) : '',
    deckKey: `${source}|${snap.playerId != null ? snap.playerId : ''}`,
    deckColor: snap.deckColor || null,
    loaded: !!snap.trackLoaded,
    trackId,
    trackKey: snap.trackKey != null ? String(snap.trackKey) : null,
    title: snap.title || null,
    artist: snap.artist || null,
    trackDurationMs: typeof snap.duration === 'number' && snap.duration > 0
      ? Math.round(snap.duration * 1000)
      : null,
    trackBPM: typeof snap.trackBPM === 'number' ? snap.trackBPM : null,
    seconds: typeof snap.seconds === 'number' ? snap.seconds : null,
    bpm: typeof snap.bpm === 'number' ? snap.bpm : null,
    playing: !!snap.playing,
  };
}

/** Normalise a stored link, filling in defaults for anything missing. */
export function withLinkDefaults(link) {
  if (!link) return null;
  return { ...DEFAULT_DJ_LINK, ...link, enabled: link.enabled !== false };
}

/**
 * A clip is triggerable when it has real content, a live link, and that link is
 * enabled. `parsing` is checked so a clip still being decoded is not fired.
 */
export function isClipLinked(clip) {
  if (!clip) return false;
  if (clip.parsing) return false;
  if (clip.type !== 'ilda' && clip.type !== 'generator') return false;
  const link = withLinkDefaults(clip.djLink);
  if (!link || !link.enabled) return false;
  return typeof link.trackId === 'string' && link.trackId.length > 0;
}

/**
 * Index the roster by track id. When the same track is loaded in more than one
 * deck the playing deck wins, then the master, then deck order — a clip must not
 * jump between decks mid-set, and the deck actually rolling is the right one to
 * follow. Ties keep the first-seen deck so the mapping is stable frame to frame.
 */
export function rosterToDeckMap(prolink = [], stagelinq = []) {
  const map = new Map();
  const rank = (deck) => (deck.playing ? 2 : 0) + (deck.isMaster ? 1 : 0);
  for (const deck of [...prolink, ...stagelinq]) {
    if (!isDeckLoaded(deck)) continue;
    const existing = map.get(deck.trackId);
    if (!existing || rank(deck) > rank(existing)) map.set(deck.trackId, deck);
  }
  return map;
}

/**
 * Walk the 4-D clip grid and return every clip whose link matches a loaded deck.
 * `clipContents` is [page][layer][col]. A deck that matches several clips
 * resolves to the lowest layer, then the leftmost column, so a show is
 * reproducible rather than dependent on object iteration order.
 */
export function findLinkedClips(clipContents, deckMap) {
  const matches = [];
  if (!clipContents || !deckMap || deckMap.size === 0) return matches;
  for (let pageId = 0; pageId < clipContents.length; pageId++) {
    const page = clipContents[pageId];
    if (!page) continue;
    for (let layerIndex = 0; layerIndex < page.length; layerIndex++) {
      const row = page[layerIndex];
      if (!row) continue;
      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        const clip = row[colIndex];
        if (!isClipLinked(clip)) continue;
        const deck = deckMap.get(clip.djLink.trackId);
        if (!deck) continue;
        matches.push({ pageId, layerIndex, colIndex, clip, deck });
      }
    }
  }
  return matches;
}

/** Seconds -> `m:ss`, matching the DJ-Link readout. */
export function formatClock(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '--:--';
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Track duration in seconds from any of the sources that can supply it. */
export function deckDurationSec(deck) {
  if (!deck) return 0;
  if (typeof deck.trackDurationMs === 'number' && deck.trackDurationMs > 0) {
    return deck.trackDurationMs / 1000;
  }
  return 0;
}

/**
 * Signed direction of travel from the previous playhead sample.
 * Returns 0 for no movement, +1 forward, -1 backward.
 */
export function signedDelta(nowSec, prevSec, deadband = DIRECTION_DEADBAND_SEC) {
  if (nowSec == null || prevSec == null) return 0;
  if (!Number.isFinite(nowSec) || !Number.isFinite(prevSec)) return 0;
  const delta = nowSec - prevSec;
  if (Math.abs(delta) <= deadband) return 0;
  return delta > 0 ? 1 : -1;
}

/** Clamp to 0..1, mapping anything non-finite to 0. */
const clamp01 = (v) => {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
};

/** Clamp to [lo, hi]; a non-finite input falls back to `fallback`. */
const clamp = (v, lo, hi, fallback = 0) => {
  if (!Number.isFinite(v)) return fallback;
  return v < lo ? lo : v > hi ? hi : v;
};

/**
 * Playhead movement beyond this is a seek/scrub/track change, not playback, so
 * the phase is re-anchored to the deck's actual position instead of integrated.
 * A jump of a few seconds can be a 1.5x fast-forward; a jump of a minute is the
 * operator dragging the jogwheel. Anything past the threshold is the latter, and
 * integrating it would leave the animation somewhere the deck never was.
 */
export const REANCHOR_SEC = 4;

/**
 * The loop-mode phase accumulator.
 *
 * Phase is ANCHORED to the deck's absolute beat position rather than integrated
 * from zero, because the loop has to be phase-locked to the track: cue a track
 * at 2:30 and the animation must already sit at the 2:30 phase, not at the top
 * of the loop. Anchoring also means a jogwheel scrub moves the animation in loop
 * mode exactly as it does in position mode.
 *
 * Between anchors the anchor itself is held fixed and only the increment uses
 * the current tempo, so the smoothed/EMA'd BPM that the deck reports (and which
 * wobbles a little on every packet) cannot make the loop jitter.
 */
export function advanceLoopBeats(anchorBeats, anchorPosSec, positionSec, bpm, followDirection) {
  if (!Number.isFinite(bpm) || bpm <= 0) return Number.isFinite(anchorBeats) ? anchorBeats : 0;
  const pos = Number.isFinite(positionSec) ? positionSec : 0;
  const beatsPerSec = bpm / 60;
  const delta = pos - (Number.isFinite(anchorPosSec) ? anchorPosSec : pos);
  if (Math.abs(delta) >= REANCHOR_SEC) return pos * beatsPerSec;
  // A clip opted out of direction following still integrates a reverse jog
  // forward — the animation keeps running one way while the deck runs the other.
  const step = followDirection === false ? Math.abs(delta) : delta;
  return (Number.isFinite(anchorBeats) ? anchorBeats : 0) + step * beatsPerSec;
}

/** Positive modulo — JS `%` keeps the sign of the dividend. */
export const wrap = (value, length) => {
  if (!(length > 0)) return 0;
  return ((value % length) + length) % length;
};

/**
 * Resolve a linked clip's position within itself (0..1) from the deck state.
 *
 * `prev` is the previous call's result for the SAME deck and is what makes this
 * incremental — a paused deck holds its frame, a backward jog reverses. It is
 * mutated in place so the caller can keep passing the same object across ticks
 * without allocating.
 *
 * Returns `{ active, progress, positionSec, bpm, direction, playing, deckKey }`.
 * `active: false` means the deck is not currently driving this link and the
 * caller should not use the progress.
 */
/**
 * Realign thresholds, in seconds of disagreement between the playhead and the
 * deck's report at the same instant. Chosen from measurement, not intuition —
 * across 20 simulated 120 s runs of the measured source (position quantised to
 * 31 ms, packets 33.9/s, bursty reports 0..225 ms):
 *
 *   backward residual  p50 97ms  p95 180ms  max 228ms
 *   forward residual   always 0
 *
 * i.e. the report is *late* by up to 228 ms and the playhead is never behind it,
 * because extrapolating forward from a late report still lands ahead of where the
 * deck really is. So:
 *
 *   - BACK must clear 228 ms, or it fires constantly on lateness alone. Pulling
 *     back toward a late report loses ground every time, which is what turned
 *     quantisation into visible steps (measured 8 backward steps per 180 frames,
 *     416 ms spread, before this was fixed).
 *   - FORWARD is a safety net only; it is not expected to fire in steady playback.
 *
 * Both sit far below a genuine scrub, which is seconds, so a real jump is still
 * followed immediately.
 */
export const PLAYHEAD_REALIGN_BACK_SEC = 0.4;
export const PLAYHEAD_REALIGN_FWD_SEC = 0.35;

/**
 * Longest the tick-level playhead may run ahead of the deck's last reported
 * position before giving up and waiting for a fresh report. Must comfortably
 * exceed the slowest report interval seen in practice (measured 9.2/s ~= 110 ms)
 * or the anchor would be reset to a stale value every tick, and stay below
 * anything a listener would read as the visuals and the music disagreeing.
 */
export const PLAYHEAD_MAX_LEAD_SEC = 0.25;


export function resolveDeckProgress(link, deck, prev, nowMs) {
  const cfg = withLinkDefaults(link);
  const state = prev || {};
  const out = {
    active: false,
    progress: 0,
    positionSec: 0,
    bpm: 0,
    direction: 0,
    playing: false,
    deckKey: null,
  };
  if (!cfg || !deck) return out;
  // A link the operator has switched off must never drive a clip, whatever the
  // deck is doing.
  if (!cfg.enabled) return out;

  out.deckKey = deck.deckKey || null;
  out.playing = !!deck.playing;
  out.bpm = Number.isFinite(deck.bpm) && deck.bpm > 0 ? deck.bpm : 0;

  // A deck that swapped tracks, or a first sample, has no usable history.
  const sameDeck = state.deckKey != null && state.deckKey === out.deckKey;

  // Continuous playhead. `deck.seconds` is only republished when the deck sends
  // a packet, and that stream is slow — measured at 9.2/s on a CDJ-3000, so the
  // report can be ~110 ms old. Reading the report verbatim leaves the clip frozen
  // for ~110 ms at a time, which is the judder seen during normal playback (and
  // invisible while jogging, where each update moves a long way).
  //
  // So carry the last report forward by the time elapsed SINCE THAT REPORT was
  // observed. Measuring from the previous tick instead — which looks equivalent —
  // is not: it yields `report + oneTick` forever, a constant offset that never
  // accumulates, so the anchor holds still for the whole gap between reports. The
  // renderer re-anchors every frame-batch, and a frozen anchor made that lead
  // sawtooth: advance 33 ms, snap back 33 ms, 30x a second.
  const reportedSec = Number.isFinite(deck.seconds) ? deck.seconds : 0;
  if (typeof nowMs === 'number' && (state.reportedSec !== reportedSec || !Number.isFinite(state.reportedAtMs))) {
    if (Number.isFinite(state.reportedSec)) {
      reportDirection(state, reportedSec - state.reportedSec);
    }
    state.reportedSec = reportedSec;
    state.reportedAtMs = nowMs;
  }
  // The playhead is its OWN state, advanced at the deck's reported rate and then
  // pulled gently toward the freshest report. It deliberately does not collapse
  // onto the report: the deck's position is quantised (~31 ms measured) while
  // reports arrive in bursts 0..225 ms apart, so a report routinely disagrees with
  // a correct prediction by about a quantum. Replacing the playhead with the
  // report on every arrival turned that quantisation into visible forward and
  // backward steps — 15 backward steps per 180 output frames when measured.
  //
  // Instead: advance smoothly, and correct the residual proportionally. A real
  // scrub or cue moves the residual far past these thresholds and is
  // realigned immediately, because the operator needs to see it happen at once.
  let positionSec = reportedSec;
  if (sameDeck && typeof nowMs === 'number' && Number.isFinite(state.smoothAt)) {
    const travel = reportDirectionValue(state);
    const rate = out.playing ? playheadRate(deck, travel || 1) : 0;
    const elapsed = clamp((nowMs - state.smoothAt) / 1000, 0, PLAYHEAD_MAX_LEAD_SEC);
    let next = state.smoothSec + elapsed * rate;
    if (Number.isFinite(state.reportedSec) && Number.isFinite(state.reportedAtMs)) {
      // Where the playhead says it was AT THE INSTANT the report was taken, versus
      // where the report says it was at that same instant. Comparing the report
      // against its own extrapolation instead makes the residual a constant
      // -reportAge*rate: a systematic backward pull every tick that drifts the clip
      // seconds behind the deck.
      const playAtReport = state.smoothSec
        + clamp((state.reportedAtMs - state.smoothAt) / 1000, 0, PLAYHEAD_MAX_LEAD_SEC) * rate;
      const residual = state.reportedSec - playAtReport;
      if (residual > PLAYHEAD_REALIGN_FWD_SEC || residual < -PLAYHEAD_REALIGN_BACK_SEC) {
        next = reportedSec;
      }
    }
    positionSec = next;
    state.smoothSec = next;
    state.smoothAt = nowMs;
  } else if (typeof nowMs === 'number') {
    // First sample, or the deck changed: start from the report.
    state.smoothSec = reportedSec;
    state.smoothAt = nowMs;
    positionSec = reportedSec;
  }
  out.positionSec = positionSec;

  // Trigger gate. 'load' fires from the moment the track is in a deck (the DJ
  // cues it, the show is ready); 'play' waits until the deck is actually
  // rolling. Either way a paused deck holds its frame rather than releasing —
  // the operator decides when to stop, not a beat watchdog.
  const gateMet = cfg.trigger === 'play' ? out.playing : isDeckLoaded(deck);
  if (!gateMet) return out;
  out.active = true;

  // Travel direction, taken from the deck's reports rather than from the ramp's own
  // successive positions. The ramp is continuous by construction, so its delta
  // always reads as forward and would tell the render loop the clip is going
  // forwards even during reverse playback. Falls back to the ramp delta when the
  // reports have not yet established a direction.
  out.direction = out.playing
    ? (reportDirectionValue(state) || signedDelta(out.positionSec, sameDeck ? state.positionSec : null))
    : 0;

  if (cfg.follow === 'position') {
    // The clip is authored to cover the trim window, so the deck's position
    // maps straight onto it. Direction needs no special handling: a backward
    // scrub lowers `positionSec` and walks the frames back by itself.
    const full = deckDurationSec(deck);
    const start = Number.isFinite(cfg.startSec) && cfg.startSec > 0 ? cfg.startSec : 0;
    let end = Number.isFinite(cfg.endSec) && cfg.endSec > start ? cfg.endSec : full;
    // No usable track duration (unanalyzed / metadata still loading): fall back
    // to the linked snapshot so the window is at least the deck's own reading.
    if (!(end > start)) end = start + (full || out.positionSec || 1);
    out.progress = clamp01((out.positionSec - start) / (end - start));
  } else {
    // Loop mode. The phase is anchored to the deck's absolute beat position, so
    // it survives a track change, a cue at an arbitrary point, and a jog scrub
    // without any special-casing — only the increment is integrated, so a
    // wobbling reported BPM cannot make the loop stutter.
    const reanchor = !sameDeck || state.trackId !== cfg.trackId;
    const anchorBeats = reanchor
      ? out.positionSec * (out.bpm > 0 ? out.bpm / 60 : 0)
      : state.beats;
    const anchorPos = reanchor ? out.positionSec : state.anchorPosSec;
    const beats = advanceLoopBeats(anchorBeats, anchorPos, out.positionSec, out.bpm, cfg.followDirection);
    state.beats = beats;
    state.anchorPosSec = out.positionSec;
    const loopBeats = Number.isFinite(cfg.loopBeats) && cfg.loopBeats > 0 ? cfg.loopBeats : 8;
    out.progress = clamp01(wrap(beats, loopBeats) / loopBeats);
  }

  // Persist for the next tick.
  state.deckKey = out.deckKey;
  state.positionSec = out.positionSec;
  state.trackId = cfg.trackId;
  return out;
}

/**
 * Turn a set of link/deck matches into the layer ownership the engine should
 * hold this tick, plus the activate/release edges to apply.
 *
 * Split out of the controller so the rules are testable without a DOM and
 * without a clock:
 *
 *   - A layer outputs one clip, so if several linked clips share a layer the
 *     first in grid order (lowest page, then layer, then column) takes it.
 *     Deterministic, rather than dependent on which deck reported first.
 *   - A match that is not currently `active` (a 'play'-triggered clip waiting
 *     for the deck to roll) neither claims its layer nor publishes a clock.
 *   - A layer is only RELEASED if it is still showing the clip we put there. If
 *     the operator has fired a pad on it since, their choice wins.
 *
 * `activeLayers` is called as `activeLayers(layerIndex)` and must return the
 * layer's current `{ pageId, colIndex }` or null; `matches` must already be in
 * grid order.
 */
export function resolveTransportPlan(matches, owned, activeLayers, anchorAt) {
  const nextOwned = {};
  const claimed = new Set();

  for (const match of matches) {
    const { pageId, layerIndex, colIndex, clip, deck, resolved } = match;
    if (claimed.has(layerIndex)) continue;
    // Not yet triggerable (disabled link, or waiting for the deck to roll).
    if (!resolved || !resolved.active) continue;
    const workerId =
      clip.type === 'ilda'
        ? clip.workerId
        : `generator-${pageId}-${layerIndex}-${colIndex}`;
    if (!workerId) continue;

    claimed.add(layerIndex);
    nextOwned[layerIndex] = {
      pageId,
      colIndex,
      workerId,
      deckKey: deck.deckKey,
      trackId: clip.djLink.trackId,
      clock: {
        active: true,
        progress: resolved.progress,
        positionSec: resolved.positionSec,
        bpm: resolved.bpm,
        direction: resolved.direction,
        playing: resolved.playing,
        deckKey: deck.deckKey,
        // When this progress value was computed, on the performance.now() timebase
        // the render loop's rAF timestamp shares. The transport ticks at 30Hz but
        // the render loop runs on every animation frame, so the renderer needs
        // both of these to advance the clip itself between ticks — see
        // advanceDjProgress. Null anchorAt means "no extrapolation", which is
        // what every non-render caller wants.
        anchorAt: Number.isFinite(anchorAt) ? anchorAt : null,
        // Real-time seconds for one full 0..1 pass of the clip. In BOTH follow
        // modes dProgress/dt is exactly 1/durationSec (position mode maps seconds
        // to seconds; loop mode advances at bpm/60 beats per second over
        // loopBeats), so the render loop needs this one number to convert elapsed
        // wall time into progress.
        durationSec: linkedClipDurationSec(clip.djLink, deck),
        deck,
        link: withLinkDefaults(clip.djLink),
      },
    };
  }

  const activate = [];
  for (const layerIndex of Object.keys(nextOwned)) {
    const want = nextOwned[layerIndex];
    const have = owned[layerIndex];
    const unchanged =
      have &&
      have.pageId === want.pageId &&
      have.colIndex === want.colIndex &&
      have.deckKey === want.deckKey;
    if (!unchanged) {
      activate.push({ layerIndex: Number(layerIndex), pageId: want.pageId, colIndex: want.colIndex, deckKey: want.deckKey });
    }
  }

  const release = [];
  for (const layerIndex of Object.keys(owned)) {
    const idx = Number(layerIndex);
    if (nextOwned[idx]) continue;
    const cur = owned[idx];
    const live = activeLayers ? activeLayers(idx) : null;
    // The operator fired something else on this layer after we took it.
    if (live && (live.colIndex !== cur.colIndex || live.pageId !== cur.pageId)) continue;
    release.push(idx);
  }

  return { nextOwned, activate, release };
}

/**
 * Build a deck descriptor straight from a raw `prolink-status` /
 * `stagelinq-status` packet (the followed-deck stream the middle bar already
 * renders), rather than from a display snapshot.
 *
 * This exists so the Clip Transport can still see a deck when the multi-deck
 * `djlink-decks` roster channel is unavailable — preload.js only takes effect
 * when the app restarts, so a renderer hot-reload leaves a stale preload
 * without that method. The identity produced here is the SAME `trackId` the
 * roster uses, so a clip linked from either path matches either source.
 */
export function deckDescriptorFromStatus(source, status) {
  if (!status) return null;
  // A CDJ reports trackId 0 when nothing is loaded, which would stringify to the
  // non-empty "0" and become a bogus link identity. Only a positive number or a
  // non-empty string counts (StageLinq uses a track network path).
  const rawId = status.trackId;
  const usable = (typeof rawId === 'number' && rawId > 0)
    || (typeof rawId === 'string' && rawId.length > 0);
  if (!usable) return null;
  const trackId = String(rawId);
  const playerId = status.playerId != null ? String(status.playerId) : '';
  return {
    source,
    deckId: playerId,
    deckKey: `${source}|${playerId}`,
    deckColor: status.deckColor || null,
    loaded: !!status.trackLoaded,
    trackId,
    trackKey: status.trackKey != null ? String(status.trackKey) : null,
    title: status.trackTitle || null,
    artist: status.trackArtist || null,
    // NOTE: the raw status packet calls this `trackDuration`; the roster entry
    // calls it `trackDurationMs`. Both are milliseconds.
    trackDurationMs: typeof status.trackDuration === 'number' ? status.trackDuration : null,
    trackBPM: status.trackBPM != null ? status.trackBPM : null,
    seconds: typeof status.seconds === 'number' ? status.seconds : null,
    bpm: status.bpm != null ? status.bpm : (status.effectiveBpm != null ? status.effectiveBpm : null),
    playing: status.playState === 3 || status.playState === 4 || status.playState === true,
  };
}

/**
 * Merge the multi-deck roster with the followed-deck status streams.
 *
 * The two sources have complementary strengths, and the ORDER MATTERS:
 *
 *   - `roster` (djlink-decks) covers EVERY deck, including ones that are cued but
 *     not being followed. But for a Pro DJ Link deck it has only an approximate
 *     playhead — `beat * 60 / trackBPM`, which is null whenever the raw device
 *     state carries no beat index. A null playhead reads as 0, which sends the
 *     loop phase backwards and freezes the clip.
 *   - `followed` (prolink-status / stagelinq-status) covers only the deck the show
 *     clock is on, but its playhead is the precise, continuously advanced one
 *     (grid-anchored, pitch-scaled, sub-beat interpolated).
 *
 * So the status entry wins for the deck it covers, and the roster only supplies
 * the decks the status stream does not mention. Dedupe on trackId as well as
 * deckKey, because the two sources build their deckKey differently (Pro DJ Link
 * agrees, StageLinq does not) and trackId is the identity links are made against.
 */
export function mergeRosterSources(roster, followed) {
  const out = [];
  const seenDeckKeys = new Set();
  const seenTrackIds = new Set();
  const push = (deck) => {
    if (!deck || !deck.deckKey) return;
    if (seenDeckKeys.has(deck.deckKey)) return;
    if (deck.trackId && seenTrackIds.has(deck.trackId)) return;
    seenDeckKeys.add(deck.deckKey);
    if (deck.trackId) seenTrackIds.add(deck.trackId);
    out.push(deck);
  };

  // Precise playhead first.
  for (const src of ['prolink', 'stagelinq']) push(followed && followed[src]);
  // Then the decks only the roster knows about.
  for (const src of ['prolink', 'stagelinq']) {
    for (const deck of (roster && roster[src]) || []) push(deck);
  }
  return out;
}

/**
 * Does this drag carry a song link, i.e. should the clip highlight as a LINK
 * target rather than a content-replacement target?
 *
 * `dataTransfer.getData` is unreadable until the drop, so `types` is the only
 * signal available during dragover — and Chromium's exposure of CUSTOM types
 * there has varied between versions. So rather than depend on seeing our own
 * MIME, treat "not one of our known internal payloads" as a song link: the
 * internal ones are `application/json` (effects / DACs / generators) and `Files`
 * (.ild drops). A false positive only highlights the clip and then reports a
 * clear message on drop; a false negative means no highlight and no visible drop
 * target, which is what made the feature look broken.
 */
export function isSongLinkDrag(types) {
  const list = Array.from(types || []);
  if (list.includes(DJLINK_TRACK_MIME)) return true;
  const isKnownInternal = list.includes('application/json') || list.includes('Files');
  return !isKnownInternal;
}

/**
 * Duration of one pass of a linked clip, in seconds — what effect sync needs so
 * a parameter animation on a linked clip runs at the same rate the clip does.
 * Loop mode divides by the LIVE deck tempo, so a tempo change retimes the
 * effects along with the frames. The live deck (not the link snapshot) is
 * preferred for the window length, since the snapshot is taken at drop time and
 * the deck's own duration is the live truth.
 */
export function linkedClipDurationSec(link, deck) {
  const cfg = withLinkDefaults(link);
  if (!cfg) return 1;
  if (cfg.follow === 'position') {
    const full = deckDurationSec(deck) || (cfg.trackDurationMs || 0) / 1000;
    const start = Number.isFinite(cfg.startSec) && cfg.startSec > 0 ? cfg.startSec : 0;
    const end = Number.isFinite(cfg.endSec) && cfg.endSec > start ? cfg.endSec : full;
    return end > start ? end - start : 1;
  }
  const deckBpm = deck && Number.isFinite(deck.bpm) && deck.bpm > 0 ? deck.bpm : 0;
  const bpm = deckBpm || 120;
  const loopBeats = Number.isFinite(cfg.loopBeats) && cfg.loopBeats > 0 ? cfg.loopBeats : 8;
  return (loopBeats * 60) / bpm;
}

/**
 * Longest lead the render loop will extrapolate for. A backgrounded tab, a long
 * GC pause or a stalled render loop must not jump the clip a whole pass forward
 * on the frame it recovers from; the next transport tick re-anchors it anyway,
 * so clamping costs nothing but caps the worst case.
 */
/**
 * Playback rate implied by the deck's own tempo readout: effective BPM over the
 * track's analysed BPM, i.e. 1 + pitch/100. Negative during a reverse scrub.
 *
 * Deliberately NOT measured from the reported positions. Measured: the CDJ's
 * position is quantised to ~31 ms while reports arrive in bursts 0..225 ms
 * apart, so a position delta over a short interval reads as a very high rate and
 * over a long one as a very low rate. Even a median over several intervals was
 * wrong often enough that the prediction over-ran the truth and the next report
 * yanked it backwards — measured at 15 backward steps per 180 output frames. The
 * tempo readout is neither quantised nor dependent on when we sampled.
 */
const playheadRate = (deck, direction) => {
  const effective = deck && Number.isFinite(deck.bpm) && deck.bpm > 0 ? deck.bpm : null;
  const track = deck && Number.isFinite(deck.trackBPM) && deck.trackBPM > 0 ? deck.trackBPM : null;
  const magnitude = effective == null || track == null ? 1 : clamp(effective / track, 0.05, 4);
  return magnitude * (direction < 0 ? -1 : 1);
};

/**
 * Which way the deck is actually travelling, taken from the reported positions.
 *
 * The tempo readout is the right source for HOW FAST the track moves (it knows the
 * pitch slider) but it cannot know the SIGN: reverse playback and a backward jog
 * both leave it reporting the track's own positive tempo. Ramping forward through
 * either made the residual grow until the realign snapped the playhead, which is
 * what remained after steady playback was fixed — visible as jumping when
 * switching between forward and reverse, and while scratching.
 *
 * A short majority vote over the sign of recent report deltas. Majority rather
 * than last-value because the position is quantised (~31 ms), so single deltas can
 * be zero or noisy; the deadband discards those entirely.
 */
const PLAYHEAD_DIRECTION_SIGNS = 3;
const PLAYHEAD_DIRECTION_DEADBAND_SEC = 0.05;
const reportDirection = (state, delta) => {
  if (!Number.isFinite(delta) || Math.abs(delta) <= PLAYHEAD_DIRECTION_DEADBAND_SEC) return;
  const signs = state.reportSigns || [];
  signs.push(delta > 0 ? 1 : -1);
  while (signs.length > PLAYHEAD_DIRECTION_SIGNS) signs.shift();
  state.reportSigns = signs;
};
const reportDirectionValue = (state) => {
  const signs = state.reportSigns;
  if (!signs || signs.length < 2) return 0;
  const sum = signs.reduce((a, b) => a + b, 0);
  return sum > 0 ? 1 : sum < 0 ? -1 : 0;
};

export const DJ_MAX_LEAD_SEC = 0.25;

/**
 * Progress for a linked clip at render time, advanced from the clock's anchor.
 *
 * The transport publishes a fresh clock on a 30Hz timer, but the render loop runs
 * on requestAnimationFrame, so on a 60Hz or faster display two rendered frames
 * share one progress value. That is the judder seen during normal playback — and
 * it is invisible while jogging the deck, because there each 30Hz update moves a
 * long way and the stepping is far below the motion. Smoothing the value inside
 * the 30Hz tick cannot fix that: the renderer still only ever receives 30 distinct
 * values per second. The advance has to happen where the frames are.
 *
 * dProgress/dt is direction/durationSec in both follow modes, so elapsed wall
 * time converts directly. `direction` is 0 for a paused or first sample, which is
 * what makes a stopped deck hold its frame.
 */
export function advanceDjProgress(clock, nowTimestamp) {
  if (!clock || !clock.active) return 0;
  const progress = Number.isFinite(clock.progress) ? clock.progress : 0;
  let out = progress;
  if (
    Number.isFinite(clock.anchorAt) &&
    Number.isFinite(nowTimestamp) &&
    Number.isFinite(clock.durationSec) &&
    clock.durationSec > 0
  ) {
    const lead = Math.min(
      Math.max(0, (nowTimestamp - clock.anchorAt) / 1000),
      DJ_MAX_LEAD_SEC
    );
    const direction = Number.isFinite(clock.direction) ? clock.direction : 0;
    out += direction * (lead / clock.durationSec);
  }
  // Wrap into 0..1, which also maps a negative (jogged backwards) value correctly.
  return out - Math.floor(out);
}
