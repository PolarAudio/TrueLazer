import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deckDescriptorFromStatus,
  findLinkedClips,
  mergeRosterSources,
  resolveDeckProgress,
  resolveTransportPlan,
  rosterToDeckMap,
} from '../utils/djLinkTracks';

/**
 * DJ-Link Clip Transport.
 *
 * Sits between the deck roster (main process, ~20 Hz over `djlink-decks`) and
 * the clip engine. Every tick it:
 *
 *   1. matches linked clips against the loaded decks,
 *   2. activates / deactivates layers to match (deck link wins its layer),
 *   3. publishes a per-clip clock into `clockRef` for `processClip` to read.
 *
 * The matching and ownership rules live in `resolveTransportPlan` (pure, unit
 * tested); this hook owns only the timing and the side effects.
 *
 * Two rules shape the implementation:
 *
 *   - The roster NEVER enters React state on this path. It arrives ~20x/s and
 *     the render loop runs at 60-120 fps; routing it through state would
 *     re-render the whole app between every output frame. It lives in a ref, and
 *     the only React state is a slow mirror for the settings window's deck list.
 *   - This uses a `setInterval`, not `requestAnimationFrame`. The frame fetcher
 *     already owns the app's single rAF; a second one would double the wakeups
 *     for a clock that only needs 30 Hz.
 */

const TICK_MS = 33;
const DECK_MIRROR_MS = 500;
/** deckKeys already warned about a missing playhead, so the console stays readable. */
const warnedNoPlayhead = new Set();


export const useDjLinkClipTransport = ({
  enabled = true,
  getClipContents,
  getActiveClips,
  onActivate,
  onDeactivate,
  isDeckArmed,
  clockRef,
}) => {
  const rosterRef = useRef({ prolink: [], stagelinq: [] });
  /** Followed-deck descriptors derived from the always-present status streams. */
  const followedRef = useRef({ prolink: null, stagelinq: null });

  /** layerIndex -> ownership entry from resolveTransportPlan */
  const ownedRef = useRef({});
  /** deckKey -> resolveDeckProgress accumulator */
  const phaseRef = useRef({});
  /** Reported a tick failure once, so a persistent fault does not log 30x a second. */
  const tickFailedOnce = useRef(false);
  /** workerId -> { active, progress, bpm, deck, link } read by processClip */
  const localClockRef = useRef(clockRef || { current: {} });
  if (clockRef && localClockRef.current !== clockRef) localClockRef.current = clockRef;

  // Latest props without making the tick effect re-subscribe on every render.
  const optsRef = useRef({ enabled, getClipContents, getActiveClips, onActivate, onDeactivate, isDeckArmed });
  optsRef.current = { enabled, getClipContents, getActiveClips, onActivate, onDeactivate, isDeckArmed };

  // A slow mirror of the roster, purely so the Link/Sync settings window can
  // list the decks and the clip panel can show a live readout.
  const [decks, setDecks] = useState([]);
  const lastMirrorRef = useRef(0);

  // The multi-deck roster, coalesced to ~20 Hz by the main process. Preferred
  // source: it covers decks that are cued but not being followed, which is the
  // normal DJ workflow.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api || !api.onDjlinkDecks) {
      console.warn('[DJ-Link] deck roster channel unavailable (preload out of date?) — following the single deck reported by the status stream.');
      return undefined;
    }
    return api.onDjlinkDecks((payload) => {
      if (!payload) return;
      const prolink = Array.isArray(payload.prolink) ? payload.prolink : [];
      const stagelinq = Array.isArray(payload.stagelinq) ? payload.stagelinq : [];
      rosterRef.current = { prolink, stagelinq };
    });
  }, []);

  // The followed-deck status streams. These predate the roster channel and are
  // always available, so a single linked deck keeps working even if the roster
  // never arrives (a renderer hot-reload leaves the old preload in place, and
  // preload.js only reloads with the app).
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return undefined;
    const offs = [];
    if (api.onProlinkState) {
      offs.push(api.onProlinkState((st) => {
        followedRef.current.prolink = deckDescriptorFromStatus('prolink', st);
      }));
    }
    if (api.onStagelinqState) {
      offs.push(api.onStagelinqState((st) => {
        followedRef.current.stagelinq = deckDescriptorFromStatus('stagelinq', st);
      }));
    }
    return () => { for (const off of offs) { if (off) off(); } };
  }, []);

  /** Every deck we know about, roster first, followed-deck as the fallback. */
  const allDecks = useCallback(
    () => mergeRosterSources(rosterRef.current, followedRef.current),
    []
  );


  /** Unguarded body; `tick` below wraps it in an error boundary. */
  const runTick = useCallback(() => {
    const {
      enabled: isEnabled,
      getClipContents: readClips,
      getActiveClips: readActive,
      onActivate: activate,
      onDeactivate: deactivate,
      isDeckArmed: deckArmed,
    } = optsRef.current;


    const clock = localClockRef.current;
    const owned = ownedRef.current;

    // Disarming must RELEASE, not just stop. Returning early here would leave
    // every layer the deck was driving latched on with the lasers up, which is
    // the opposite of what "disarm" means on a show.
    if (!isEnabled) {
      if (clock.current) clock.current = {};
      if (Object.keys(owned).length > 0) {
        if (deactivate) {
          for (const layerIndex of Object.keys(owned)) deactivate(Number(layerIndex));
        }
        ownedRef.current = {};
      }
      return;
    }
    if (!readClips || !activate) return;

    const all = allDecks();
    const deckMap = rosterToDeckMap(
      all.filter((d) => d.source === 'prolink'),
      all.filter((d) => d.source === 'stagelinq')
    );
    // A disarmed deck is invisible to the matcher, so its clips are treated as
    // unlinked and any layer it was holding is released on this same tick.
    if (deckArmed) {
      for (const [trackId, d] of deckMap) {
        if (!deckArmed(d)) deckMap.delete(trackId);
      }
    }

    // A matched deck with NO usable playhead cannot drive a clip: position reads
    // as 0, so the loop phase walks backwards and the clip stops where it is.
    // Surface that instead of letting it look like a mysterious stall — the
    // cause is almost always a deck whose raw state carries no beat index.
    // `import.meta.env.DEV` rather than `process.env.NODE_ENV`: Vite replaces it
    // with a literal at build time, so the 30 Hz tick does no `process` lookup
    // and the branch is removed from production bundles entirely.
    if (import.meta.env.DEV) {
      for (const [trackId, d] of deckMap) {
        if (d.loaded && (d.seconds == null || !Number.isFinite(d.seconds))) {
          if (!warnedNoPlayhead.has(d.deckKey)) {
            warnedNoPlayhead.add(d.deckKey);
            console.warn(
              `[DJ-Link] deck ${d.deckKey} has a track (${trackId}) but no playhead — ` +
              'clips linked to it will hold their frame. The deck must be the one the ' +
              'BPM/transport source is following, or report Absolute Position packets.'
            );
          }
        }
      }
    }

    // Resolve every match's clip progress first, then hand the whole set to the
    // pure planner, which owns the layer-ownership rules. One wall clock for the
    // whole tick: resolveDeckProgress uses it to interpolate the playhead between
    // the deck's (slower) position reports.
    const tickNow = Date.now();
    const matches = findLinkedClips(readClips(), deckMap).map((m) => {
      const phase = phaseRef.current[m.deck.deckKey] || (phaseRef.current[m.deck.deckKey] = {});
      return { ...m, resolved: resolveDeckProgress(m.clip.djLink, m.deck, phase, tickNow) };
    });


    const plan = resolveTransportPlan(matches, owned, readActive ? (l) => readActive(l) : null, performance.now());

    for (const a of plan.activate) activate(a.layerIndex, a.colIndex, a.pageId, { deckKey: a.deckKey });
    if (deactivate) {
      for (const layerIndex of plan.release) deactivate(layerIndex);
    }

    // Replace the clock wholesale: a workerId missing from the new set must stop
    // being driven, or a released clip would keep reading its last position.
    const nextClock = {};
    for (const layerIndex of Object.keys(plan.nextOwned)) {
      const entry = plan.nextOwned[layerIndex];
      if (entry.workerId) nextClock[entry.workerId] = entry.clock;
    }
    clock.current = nextClock;
    ownedRef.current = plan.nextOwned;

    // Prune phase accumulators for decks that have gone away, or a stale
    // playhead would be integrated into whatever that deck loads next.
    const liveKeys = new Set(all.map((d) => d.deckKey));
    for (const key of Object.keys(phaseRef.current)) {
      if (!liveKeys.has(key)) delete phaseRef.current[key];
    }

    if (tickNow - lastMirrorRef.current >= DECK_MIRROR_MS) {
      lastMirrorRef.current = tickNow;
      setDecks(all);
    }
  }, [allDecks]);

  /**
   * The guarded entry point. `setInterval` keeps firing after a throw, but every
   * subsequent tick would throw at the same line, so one bad deck packet would
   * silently kill deck-driven clip transport for the rest of the session — which
   * presents as "it played for a moment and then stopped following the track".
   * On error the previous clock and ownership are left in place (the last known
   * good state, i.e. the clip holds its frame rather than blanking), and the
   * first failure is reported rather than spamming 30x a second.
   */
  const tick = useCallback(() => {
    try {
      runTick();
    } catch (err) {
      if (!tickFailedOnce.current) {
        tickFailedOnce.current = true;
        console.error(
          '[DJ-Link] clip transport tick failed; linked clips will hold their ' +
          'last frame until it recovers.', err
        );
      }
    }
  }, [runTick]);

  useEffect(() => {
    const id = setInterval(tick, TICK_MS);

    return () => {
      clearInterval(id);
      // Stop driving anything on unmount, and let go of the layers we hold so a
      // remount (page change, settings reload) does not leave lasers latched.
      const clock = localClockRef.current;
      const { onDeactivate: deactivate } = optsRef.current;
      if (clock.current) clock.current = {};
      if (deactivate) {
        for (const layerIndex of Object.keys(ownedRef.current)) deactivate(Number(layerIndex));
      }
      ownedRef.current = {};
      phaseRef.current = {};
    };
  }, [tick]);

  /**
   * How many clips in the show are linked to the track this deck currently has
   * loaded. Drives the "3 clips will fire" hint in the Link/Sync settings list.
   *
   * Counts regardless of whether the deck is armed or the master transport is on
   * — the number describes the BINDINGS, which is what the operator is deciding
   * about. Walks the live grid via the caller-supplied reader, so it reflects
   * unsaved edits the same way the engine does.
   */
  const linkedCountForDeck = useCallback((deckKey) => {
    const readClips = optsRef.current.getClipContents;
    if (!readClips) return 0;
    const deck = allDecks().find((d) => d.deckKey === deckKey);
    if (!deck || !deck.trackId) return 0;
    return findLinkedClips(readClips(), new Map([[deck.trackId, deck]])).length;
  }, [allDecks]);

  return { decks, clockRef: localClockRef, linkedCountForDeck };
};


export default useDjLinkClipTransport;
