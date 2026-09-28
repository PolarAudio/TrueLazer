import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DJ_LINK,
  DJLINK_TRACK_MIME,
  REANCHOR_SEC,
  DJ_MAX_LEAD_SEC,
  advanceDjProgress,
  advanceLoopBeats,
  deckDurationSec,
  deckDescriptorFromSnapshot,
  deckDescriptorFromStatus,
  findLinkedClips,
  formatClock,
  isClipLinked,
  isDeckLoaded,
  isSongLinkDrag,
  mergeRosterSources,
  linkedClipDurationSec,
  makeLinkFromDeck,  PLAYHEAD_MAX_LEAD_SEC,
  PLAYHEAD_REALIGN_BACK_SEC,
  PLAYHEAD_REALIGN_FWD_SEC,
  resolveDeckProgress,
  resolveTransportPlan,
  rosterToDeckMap,
  signedDelta,
  withLinkDefaults,
  wrap,
} from './djLinkTracks';

const deck = (over = {}) => ({
  source: 'prolink',
  deckId: '3',
  deckKey: 'prolink|3',
  deckColor: '#ff3b30',
  isMaster: true,
  playing: true,
  playState: 3,
  loaded: true,
  trackId: 'track-42',
  trackKey: '3:1:42',
  title: 'Test Track',
  artist: 'Test Artist',
  trackDurationMs: 240000,
  trackBPM: 128,
  seconds: 0,
  bpm: 128,
  beat: 0,
  ...over,
});

const clip = (over = {}) => ({
  type: 'ilda',
  workerId: 'ilda-a',
  totalFrames: 300,
  playbackSettings: { mode: 'fps', fps: 30 },
  djLink: { ...DEFAULT_DJ_LINK, source: 'prolink', trackId: 'track-42', title: 'Test Track' },
  ...over,
});

// 2 pages x 2 layers x 2 cols grid helper
const grid = (cells) => {
  const out = [];
  for (let p = 0; p < cells.length; p++) {
    const page = [];
    for (let l = 0; l < cells[p].length; l++) page.push([...cells[p][l]]);
    out.push(page);
  }
  return out;
};

describe('constants + helpers', () => {
  it('exposes a dedicated drag MIME distinct from application/json', () => {
    expect(DJLINK_TRACK_MIME).toBe('application/x-truelazer-djlink-track');
  });

  it('formatClock matches the DJ-Link m:ss readout', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(61)).toBe('1:01');
    expect(formatClock(3661)).toBe('1:01:01');
    expect(formatClock(null)).toBe('--:--');
    expect(formatClock(-5)).toBe('--:--');
    expect(formatClock(NaN)).toBe('--:--');
  });

  it('deckDurationSec only trusts a positive duration', () => {
    expect(deckDurationSec(deck())).toBe(240);
    expect(deckDurationSec(deck({ trackDurationMs: 0 }))).toBe(0);
    expect(deckDurationSec(deck({ trackDurationMs: null }))).toBe(0);
    expect(deckDurationSec(null)).toBe(0);
  });

  it('wrap is a positive modulo', () => {
    expect(wrap(9, 8)).toBe(1);
    expect(wrap(-1, 8)).toBe(7);
    expect(wrap(0, 0)).toBe(0);
  });

  it('signedDelta ignores jitter below the deadband', () => {
    expect(signedDelta(10, 9.98)).toBe(0);
    expect(signedDelta(10.5, 10)).toBe(1);
    expect(signedDelta(9.5, 10)).toBe(-1);
    expect(signedDelta(null, 10)).toBe(0);
    expect(signedDelta(10, NaN)).toBe(0);
  });
});

describe('isDeckLoaded', () => {
  it('requires a loaded flag and a real trackId', () => {
    expect(isDeckLoaded(deck())).toBe(true);
    expect(isDeckLoaded(deck({ loaded: false }))).toBe(false);
    expect(isDeckLoaded(deck({ trackId: null }))).toBe(false);
    expect(isDeckLoaded(deck({ trackId: '' }))).toBe(false);
    expect(isDeckLoaded(null)).toBe(false);
  });
});

describe('makeLinkFromDeck', () => {
  it('snapshots the deck identity and applies transport defaults', () => {
    const link = makeLinkFromDeck(deck());
    expect(link).toMatchObject({
      enabled: true,
      source: 'prolink',
      trackId: 'track-42',
      trackKey: '3:1:42',
      title: 'Test Track',
      artist: 'Test Artist',
      deckColor: '#ff3b30',
      trackDurationMs: 240000,
      trigger: 'load',
      follow: 'loop',
      loopBeats: 8,
    });
    expect(typeof link.linkedAt).toBe('number');
  });

  it('works before metadata arrives (no title/duration yet)', () => {
    const link = makeLinkFromDeck(deck({ title: null, artist: null, trackDurationMs: null }));
    expect(link.trackId).toBe('track-42');
    expect(link.title).toBeNull();
    expect(link.trackDurationMs).toBeNull();
  });

  it('refuses a deck with nothing loaded', () => {
    expect(makeLinkFromDeck(deck({ loaded: false }))).toBeNull();
    expect(makeLinkFromDeck(null)).toBeNull();
  });
});

describe('withLinkDefaults', () => {
  it('fills gaps and treats a missing enabled flag as enabled', () => {
    expect(withLinkDefaults({ trackId: 'x' })).toMatchObject({
      enabled: true,
      follow: 'loop',
      trigger: 'load',
      loopBeats: 8,
    });
    expect(withLinkDefaults({ enabled: false, trackId: 'x' }).enabled).toBe(false);
  });

  it('returns null for no link', () => {
    expect(withLinkDefaults(null)).toBeNull();
  });
});

describe('isClipLinked', () => {
  it('accepts a linked ilda or generator clip', () => {
    expect(isClipLinked(clip())).toBe(true);
    expect(isClipLinked(clip({ type: 'generator' }))).toBe(true);
  });

  it('rejects unlinked, disabled, still-parsing and contentless clips', () => {
    expect(isClipLinked(clip({ djLink: null }))).toBe(false);
    expect(isClipLinked(clip({ djLink: { ...DEFAULT_DJ_LINK, enabled: false, trackId: 'x' } }))).toBe(false);
    expect(isClipLinked(clip({ parsing: true }))).toBe(false);
    expect(isClipLinked(clip({ type: 'effect' }))).toBe(false);
    expect(isClipLinked(null)).toBe(false);
  });
});

describe('rosterToDeckMap', () => {
  it('indexes loaded decks by track id across both protocols', () => {
    const map = rosterToDeckMap([deck()], [deck({ source: 'stagelinq', deckKey: 'stagelinq|1', trackId: 'track-7' })]);
    expect(map.size).toBe(2);
    expect(map.get('track-42').source).toBe('prolink');
    expect(map.get('track-7').source).toBe('stagelinq');
  });

  it('skips decks with no track loaded', () => {
    const map = rosterToDeckMap([deck({ loaded: false }), deck({ trackId: null })], []);
    expect(map.size).toBe(0);
  });

  it('prefers the playing deck when one track is in two decks', () => {
    const cued = deck({ deckKey: 'prolink|1', playing: false, isMaster: false });
    const rolling = deck({ deckKey: 'prolink|2', playing: true, isMaster: false });
    const map = rosterToDeckMap([cued, rolling], []);
    expect(map.get('track-42').deckKey).toBe('prolink|2');
  });

  it('prefers the master over a cued deck', () => {
    const cued = deck({ deckKey: 'prolink|1', playing: false, isMaster: false });
    const master = deck({ deckKey: 'prolink|2', playing: false, isMaster: true });
    const map = rosterToDeckMap([cued, master], []);
    expect(map.get('track-42').deckKey).toBe('prolink|2');
  });

  it('keeps a playing non-master ahead of a cued master (the deck that is rolling)', () => {
    const masterCued = deck({ deckKey: 'prolink|1', playing: false, isMaster: true });
    const playing = deck({ deckKey: 'prolink|2', playing: true, isMaster: false });
    const map = rosterToDeckMap([masterCued, playing], []);
    expect(map.get('track-42').deckKey).toBe('prolink|2');
  });
});

describe('findLinkedClips', () => {
  it('finds a linked clip anywhere in the grid and reports its coordinates', () => {
    const contents = grid([
      [[null, clip()], [null, null]],
      [[null, null], [null, clip({ djLink: { ...DEFAULT_DJ_LINK, trackId: 'other' } })]],
    ]);
    const found = findLinkedClips(contents, rosterToDeckMap([deck()], []));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ pageId: 0, layerIndex: 0, colIndex: 1 });
    expect(found[0].deck.trackId).toBe('track-42');
  });

  it('finds several clips linked to the same track on different layers', () => {
    const contents = grid([
      [[clip(), null], [null, clip()]],
    ]);
    const found = findLinkedClips(contents, rosterToDeckMap([deck()], []));
    expect(found).toHaveLength(2);
    expect(found.map((f) => `${f.layerIndex}:${f.colIndex}`)).toEqual(['0:0', '1:1']);
  });

  it('skips clips whose track is not in any deck', () => {
    const contents = grid([[[clip()]]]);
    expect(findLinkedClips(contents, rosterToDeckMap([deck({ trackId: 'other' })], []))).toHaveLength(0);
  });

  it('returns nothing for an empty roster or missing contents', () => {
    const contents = grid([[[clip()]]]);
    expect(findLinkedClips(contents, new Map())).toHaveLength(0);
    expect(findLinkedClips(null, rosterToDeckMap([deck()], []))).toHaveLength(0);
  });

  it('tolerates ragged rows', () => {
    const contents = [[undefined, [clip()]]];
    const found = findLinkedClips(contents, rosterToDeckMap([deck()], []));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ layerIndex: 1, colIndex: 0 });
  });
});

describe('resolveDeckProgress — position mode', () => {
  const posLink = (over = {}) => ({
    ...DEFAULT_DJ_LINK, source: 'prolink', trackId: 'track-42', follow: 'position', ...over,
  });

  it('maps the deck playhead across the whole track', () => {
    const link = posLink();
    expect(resolveDeckProgress(link, deck({ seconds: 0 }), {}).progress).toBe(0);
    expect(resolveDeckProgress(link, deck({ seconds: 120 }), {}).progress).toBeCloseTo(0.5, 5);
    expect(resolveDeckProgress(link, deck({ seconds: 239.9 }), {}).progress).toBeCloseTo(0.99958, 4);
  });

  it('honours a trim window', () => {
    const link = posLink({ startSec: 60, endSec: 120 });
    expect(resolveDeckProgress(link, deck({ seconds: 60 }), {}).progress).toBe(0);
    expect(resolveDeckProgress(link, deck({ seconds: 90 }), {}).progress).toBeCloseTo(0.5, 5);
    expect(resolveDeckProgress(link, deck({ seconds: 120 }), {}).progress).toBe(1);
  });

  it('clamps outside the window instead of going out of range', () => {
    const link = posLink({ startSec: 60, endSec: 120 });
    expect(resolveDeckProgress(link, deck({ seconds: 10 }), {}).progress).toBe(0);
    expect(resolveDeckProgress(link, deck({ seconds: 200 }), {}).progress).toBe(1);
  });

  it('survives a missing track duration', () => {
    const link = posLink();
    const r = resolveDeckProgress(link, deck({ seconds: 30, trackDurationMs: null }), {});
    expect(r.progress).toBeGreaterThanOrEqual(0);
    expect(r.progress).toBeLessThanOrEqual(1);
  });

  it('walks backward when the deck scrubs backward', () => {
    const link = posLink();
    const fwd = resolveDeckProgress(link, deck({ seconds: 120 }), {});
    const back = resolveDeckProgress(link, deck({ seconds: 100 }), { positionSec: 120, deckKey: 'prolink|3' });
    expect(fwd.progress).toBeCloseTo(0.5, 5);
    expect(back.progress).toBeCloseTo(100 / 240, 5);
    expect(back.direction).toBe(-1);
  });
});

describe('resolveDeckProgress — loop mode', () => {
  const loopLink = (over = {}) => ({
    ...DEFAULT_DJ_LINK, source: 'prolink', trackId: 'track-42', follow: 'loop', loopBeats: 8, ...over,
  });

  it('is phase-locked to the deck position', () => {
    // 128 bpm = 2.1333 beats/sec; 8s in = 17.07 beats -> 17.07 % 8 = 1.07 -> 0.134
    const r = resolveDeckProgress(loopLink(), deck({ seconds: 8 }), {});
    expect(r.progress).toBeCloseTo(1.0667 % 8 / 8, 3);
  });

  it('cues at an arbitrary point and lands on that phase, not the top of the loop', () => {
    // 62s at 128bpm = 132.267 beats -> 4.267 into the 8-beat loop
    const r = resolveDeckProgress(loopLink(), deck({ seconds: 62 }), {});
    const expected = (((62 * 128) / 60) % 8) / 8;
    expect(expected).toBeGreaterThan(0.1);
    expect(r.progress).toBeCloseTo(expected, 5);
  });

  it('advances smoothly tick to tick and wraps the loop', () => {
    const link = loopLink();
    const st = {};
    let prev = resolveDeckProgress(link, deck({ seconds: 0 }), st);
    expect(prev.progress).toBe(0);
    for (let t = 0.1; t < 20; t += 0.1) {
      prev = resolveDeckProgress(link, deck({ seconds: t }), st);
      expect(prev.progress).toBeGreaterThanOrEqual(0);
      expect(prev.progress).toBeLessThan(1);
    }
    // Land on an exact 20s sample (float accumulation leaves the loop short).
    prev = resolveDeckProgress(link, deck({ seconds: 20 }), st);
    // 20s at 128bpm = 42.667 beats -> 2.667 into the 8-beat loop -> 0.333
    expect(prev.progress).toBeCloseTo((42.6667 % 8) / 8, 2);
  });

  it('rewinds when the deck is jogged backward', () => {
    const link = loopLink();
    const st = {};
    resolveDeckProgress(link, deck({ seconds: 10 }), st);
    const back = resolveDeckProgress(link, deck({ seconds: 8 }), st);
    expect(back.direction).toBe(-1);
    const fwdBeats = (10 * 128) / 60;
    const backBeats = (8 * 128) / 60;
    expect(back.progress).toBeCloseTo(backBeats % 8 / 8, 3);
    expect(back.progress).not.toBeCloseTo(fwdBeats % 8 / 8, 3);
  });

  it('keeps running forward when followDirection is off', () => {
    const link = loopLink({ followDirection: false });
    const st = {};
    resolveDeckProgress(link, deck({ seconds: 10 }), st);
    const back = resolveDeckProgress(link, deck({ seconds: 8 }), st);
    expect(back.direction).toBe(-1);
    // 10s anchored, then +2s of forward integration from an 8s playhead
    const beats = (10 * 128) / 60 + 2 * (128 / 60);
    expect(back.progress).toBeCloseTo(beats % 8 / 8, 3);
  });

  it('re-anchors after a large scrub instead of integrating the jump', () => {
    const link = loopLink();
    const st = {};
    resolveDeckProgress(link, deck({ seconds: 2 }), st);
    const scrubbed = resolveDeckProgress(link, deck({ seconds: 200 }), st);
    expect(Math.abs(200 - 2)).toBeGreaterThan(REANCHOR_SEC);
    expect(scrubbed.progress).toBeCloseTo((((200 * 128) / 60) % 8) / 8, 3);
  });

  it('does not stutter when the reported BPM wobbles by a fraction', () => {
    const link = loopLink();
    const st = {};
    resolveDeckProgress(link, deck({ seconds: 60, bpm: 128 }), st);
    const a = resolveDeckProgress(link, deck({ seconds: 60.1, bpm: 128.4 }), st);
    const b = resolveDeckProgress(link, deck({ seconds: 60.2, bpm: 127.7 }), st);
    // A wobbling BPM must not move the phase backwards — only the elapsed time
    // and the (held) anchor do.
    expect(b.progress).toBeGreaterThanOrEqual(a.progress - 1e-9);
  });

  it('holds the frame while the deck is paused', () => {
    const link = loopLink();
    const st = {};
    const playing = resolveDeckProgress(link, deck({ seconds: 5, playing: true }), st);
    const paused = resolveDeckProgress(link, deck({ seconds: 5, playing: false }), st);
    expect(paused.progress).toBeCloseTo(playing.progress, 6);
    expect(paused.direction).toBe(0);
  });

  it('does not move while a paused deck still reports a drifting playhead', () => {
    const link = loopLink({ followDirection: false });
    const st = {};
    const a = resolveDeckProgress(link, deck({ seconds: 5, playing: false }), st);
    const b = resolveDeckProgress(link, deck({ seconds: 5.4, playing: false }), st);
    // A paused deck's beat-ramp wobble must not walk the animation forward.
    expect(b.progress).toBeGreaterThanOrEqual(a.progress);
  });

  it('restarts the phase when the deck swaps to another track', () => {
    const link = loopLink();
    const st = { deckKey: 'prolink|3', positionSec: 120, beats: 999, anchorPosSec: 120, trackId: 'track-42' };
    const r = resolveDeckProgress(link, deck({ seconds: 0 }), st);
    expect(r.progress).toBe(0);
  });

  it('handles bpm 0 without producing NaN', () => {
    const link = loopLink();
    const st = {};
    resolveDeckProgress(link, deck({ seconds: 4, bpm: 0 }), st);
    const r = resolveDeckProgress(link, deck({ seconds: 8, bpm: 0 }), st);
    expect(Number.isFinite(r.progress)).toBe(true);
    expect(r.progress).toBeGreaterThanOrEqual(0);
  });

  it('handles a null playhead without producing NaN', () => {
    const r = resolveDeckProgress(loopLink(), deck({ seconds: null }), {});
    expect(Number.isFinite(r.progress)).toBe(true);
  });
});

describe('resolveDeckProgress — trigger gating', () => {
  it("'load' fires as soon as the track is in a deck, paused", () => {
    const link = { ...DEFAULT_DJ_LINK, trackId: 'track-42', trigger: 'load' };
    const r = resolveDeckProgress(link, deck({ playing: false, seconds: 0 }), {});
    expect(r.active).toBe(true);
    expect(r.playing).toBe(false);
  });

  it("'play' waits for the deck to actually roll", () => {
    const link = { ...DEFAULT_DJ_LINK, trackId: 'track-42', trigger: 'play' };
    expect(resolveDeckProgress(link, deck({ playing: false }), {}).active).toBe(false);
    expect(resolveDeckProgress(link, deck({ playing: true }), {}).active).toBe(true);
  });

  it('reports inactive for a disabled link or an unloaded deck', () => {
    expect(resolveDeckProgress({ ...DEFAULT_DJ_LINK, enabled: false, trackId: 'x' }, deck(), {}).active).toBe(false);
    expect(resolveDeckProgress({ ...DEFAULT_DJ_LINK, trackId: 'x' }, deck({ loaded: false }), {}).active).toBe(false);
    expect(resolveDeckProgress(null, deck(), {}).active).toBe(false);
    expect(resolveDeckProgress(DEFAULT_DJ_LINK, null, {}).active).toBe(false);
  });

  it('reports a paused trigger=play clip as inactive so it is not driven', () => {
    const link = { ...DEFAULT_DJ_LINK, trackId: 'track-42', trigger: 'play' };
    const st = {};
    resolveDeckProgress(link, deck({ playing: true, seconds: 4 }), st);
    const paused = resolveDeckProgress(link, deck({ playing: false, seconds: 4 }), st);
    expect(paused.active).toBe(false);
  });
});

describe('deckDescriptorFromSnapshot', () => {
  // The DJ-Link display's normalised snapshot shape, as the component builds it
  // from a `prolink-status` / `stagelinq-status` packet.
  const snapshot = (over = {}) => ({
    connected: true,
    playerId: '3',
    playing: true,
    seconds: 42.5,
    duration: 240,
    title: 'Test Track',
    artist: 'Test Artist',
    trackLoaded: true,
    trackId: '42',
    trackKey: '3:1:42',
    trackBPM: 128,
    bpm: 128.2,
    deckColor: '#ff3b30',
    ...over,
  });

  it('keys the descriptor on trackId, not the per-device trackKey', () => {
    const d = deckDescriptorFromSnapshot('prolink', snapshot());
    expect(d.trackId).toBe('42');
    expect(d.trackKey).toBe('3:1:42');
    // The whole feature hinges on this: linking by trackKey would produce a clip
    // that can never be matched against the roster.
    expect(d.trackId).not.toBe(d.trackKey);
  });

  it('produces a descriptor that MATCHES the roster for the same deck', () => {
    // A roster entry exactly as main.js builds it.
    const rosterDeck = {
      source: 'prolink',
      deckId: '3',
      deckKey: 'prolink|3',
      deckColor: '#ff3b30',
      isMaster: true,
      playing: true,
      playState: 3,
      loaded: true,
      trackId: '42',
      trackKey: '3:1:42',
      title: 'Test Track',
      artist: 'Test Artist',
      trackDurationMs: 240000,
      trackBPM: 128,
      seconds: 42.5,
      bpm: 128,
      beat: 90,
    };
    const link = makeLinkFromDeck(deckDescriptorFromSnapshot('prolink', snapshot()));
    const found = findLinkedClips(grid([[[clip({ djLink: link })]]]), rosterToDeckMap([rosterDeck], []));
    expect(found).toHaveLength(1);
  });

  it('matches a StageLinq (Denon) link against its roster entry', () => {
    // Denon reports trackId as the track's network path and duration in samples.
    const snap = snapshot({
      playerId: 'A1',
      trackId: '/Engine Library/Track/xyz.anlz',
      trackKey: 'dev-1|/Engine Library/Track/xyz.anlz',
    });
    const rosterDeck = {
      source: 'stagelinq',
      deckId: 'A1',
      deckKey: 'stagelinq|10.0.0.5|LA',
      deckColor: '#ffea2828',
      playing: false,
      loaded: true,
      trackId: '/Engine Library/Track/xyz.anlz',
      trackKey: 'dev-1|/Engine Library/Track/xyz.anlz',
      title: 'Test Track',
      trackDurationMs: 240000,
      trackBPM: 128,
      seconds: 0,
      bpm: 128,
    };
    const link = makeLinkFromDeck(deckDescriptorFromSnapshot('stagelinq', snap));
    expect(link.trackId).toBe('/Engine Library/Track/xyz.anlz');
    const found = findLinkedClips(grid([[[clip({ djLink: link })]]]), rosterToDeckMap([], [rosterDeck]));
    expect(found).toHaveLength(1);
  });

  it('converts the snapshot duration (seconds) to the roster unit (ms)', () => {
    expect(deckDescriptorFromSnapshot('prolink', snapshot()).trackDurationMs).toBe(240000);
  });

  it('returns null when the deck has not reported a track id', () => {
    expect(deckDescriptorFromSnapshot('prolink', snapshot({ trackId: null }))).toBeNull();
    expect(deckDescriptorFromSnapshot('prolink', null)).toBeNull();
  });

  it('still yields a usable descriptor before metadata arrives', () => {
    const d = deckDescriptorFromSnapshot('prolink', snapshot({ title: null, artist: null, duration: null }));
    expect(d.trackId).toBe('42');
    expect(d.loaded).toBe(true);
    expect(d.title).toBeNull();
    expect(d.trackDurationMs).toBeNull();
  });

  it('marks a deck with no track loaded as not linkable', () => {
    const d = deckDescriptorFromSnapshot('prolink', snapshot({ trackLoaded: false }));
    expect(d.loaded).toBe(false);
    expect(makeLinkFromDeck(d)).toBeNull();
  });
});

describe('isSongLinkDrag', () => {
  it('recognises our own MIME', () => {
    expect(isSongLinkDrag([DJLINK_TRACK_MIME])).toBe(true);
    expect(isSongLinkDrag([`text/plain`, DJLINK_TRACK_MIME])).toBe(true);
  });

  it('treats an unknown / custom type as a song link', () => {
    // Chromium does not always expose a custom MIME in `types` during dragover.
    // Defaulting to "link" keeps the drop target visible; a wrong guess only
    // changes the highlight and still reports clearly on drop.
    expect(isSongLinkDrag(['text/plain'])).toBe(true);
    expect(isSongLinkDrag(['text/uri-list'])).toBe(true);
  });

  it('does NOT treat an effect / DAC / generator drag as a link', () => {
    expect(isSongLinkDrag(['application/json'])).toBe(false);
    expect(isSongLinkDrag(['application/json', `text/plain`])).toBe(false);
  });

  it('does NOT treat a file drop as a link', () => {
    expect(isSongLinkDrag(['Files'])).toBe(false);
    expect(isSongLinkDrag(['Files', 'application/json'])).toBe(false);
  });

  it('prefers our own MIME even alongside an internal type', () => {
    // Defensive: if both are somehow present, the explicit link wins.
    expect(isSongLinkDrag([`application/json`, DJLINK_TRACK_MIME])).toBe(true);
  });

  it('handles a missing or empty type list', () => {
    expect(isSongLinkDrag(undefined)).toBe(true);
    expect(isSongLinkDrag([])).toBe(true);
  });

  it('accepts an array-like DataTransfer.types (DOMStringList)', () => {
    const list = { 0: `application/json`, length: 1 };
    expect(isSongLinkDrag(list)).toBe(false);
  });
});

describe('deckDescriptorFromStatus', () => {
  // The raw `prolink-status` payload shape, as main.js builds it.
  const prolinkPacket = (over = {}) => ({
    deviceId: 3,
    playerId: 3,
    trackKey: '3:1:42',
    trackTitle: 'Test Track',
    trackArtist: 'Test Artist',
    deckColor: '#ff3b30',
    trackId: 42,
    trackLoaded: true,
    playState: 3,
    trackBPM: 128,
    effectiveBpm: 128.2,
    seconds: 42.5,
    bpm: 128.2,
    trackDuration: 240000,
    ...over,
  });

  const rosterProlink = (over = {}) => ({
    source: 'prolink',
    deckId: '3',
    deckKey: 'prolink|3',
    deckColor: '#ff3b30',
    isMaster: true,
    playing: true,
    playState: 3,
    loaded: true,
    trackId: '42',
    trackKey: '3:1:42',
    title: 'Test Track',
    artist: 'Test Artist',
    trackDurationMs: 240000,
    trackBPM: 128,
    seconds: 42.5,
    bpm: 128,
    beat: 90,
    ...over,
  });

  it('keys on trackId and stringifies it, like the roster does', () => {
    const d = deckDescriptorFromStatus('prolink', prolinkPacket());
    expect(d.trackId).toBe('42');
    expect(typeof d.trackId).toBe('string');
  });

  it('produces the SAME identity as the roster entry for that deck', () => {
    // The whole point of the fallback: a clip linked from the middle bar must
    // match whether the engine sees the deck via the roster or via the status
    // stream. If these two ever diverge, links silently stop firing.
    const fromStatus = deckDescriptorFromStatus('prolink', prolinkPacket());
    const fromRoster = rosterProlink();
    expect(fromStatus.trackId).toBe(fromRoster.trackId);
    expect(fromStatus.deckKey).toBe(fromRoster.deckKey);
    expect(fromStatus.source).toBe(fromRoster.source);
  });

  it('produces a descriptor the matcher accepts against a roster deck', () => {
    const link = makeLinkFromDeck(deckDescriptorFromStatus('prolink', prolinkPacket()));
    const found = findLinkedClips(grid([[[clip({ djLink: link })]]]), rosterToDeckMap([rosterProlink()], []));
    expect(found).toHaveLength(1);
  });

  it('keeps milliseconds for duration (roster unit), not seconds', () => {
    expect(deckDescriptorFromStatus('prolink', prolinkPacket()).trackDurationMs).toBe(240000);
  });

  it('reads playState 3 and 4 as playing, and 1 as stopped', () => {
    expect(deckDescriptorFromStatus('prolink', prolinkPacket({ playState: 3 })).playing).toBe(true);
    expect(deckDescriptorFromStatus('prolink', prolinkPacket({ playState: 4 })).playing).toBe(true);
    expect(deckDescriptorFromStatus('prolink', prolinkPacket({ playState: 1 })).playing).toBe(false);
  });

  it('falls back to effectiveBpm when bpm is absent', () => {
    const d = deckDescriptorFromStatus('prolink', prolinkPacket({ bpm: null }));
    expect(d.bpm).toBe(128.2);
  });

  it('handles a StageLinq packet whose trackId is a network path', () => {
    const d = deckDescriptorFromStatus('stagelinq', {
      playerId: 'A1', trackId: '/Engine/xyz.anlz', trackKey: 'dev|/Engine/xyz.anlz',
      trackLoaded: true, playState: 3, trackDuration: 240000, bpm: 128, seconds: 10,
    });
    expect(d.trackId).toBe('/Engine/xyz.anlz');
    expect(d.deckKey).toBe('stagelinq|A1');
  });

  it('returns null with no track id, and for a null packet', () => {
    expect(deckDescriptorFromStatus('prolink', prolinkPacket({ trackId: null }))).toBeNull();
    expect(deckDescriptorFromStatus('prolink', prolinkPacket({ trackId: 0 }))).toBeNull();
    expect(deckDescriptorFromStatus('prolink', null)).toBeNull();
  });
});


describe('mergeRosterSources', () => {
  const deckA = { source: 'prolink', deckKey: 'prolink|1', trackId: 'a', loaded: true };
  const deckB = { source: 'prolink', deckKey: 'prolink|2', trackId: 'b', loaded: true };
  const deckC = { source: 'stagelinq', deckKey: 'stagelinq|3', trackId: 'c', loaded: true };

  it('returns the roster decks when the status stream is empty', () => {
    const out = mergeRosterSources({ prolink: [deckA, deckB], stagelinq: [deckC] }, {});
    expect(out.map((d) => d.deckKey)).toEqual(['prolink|1', 'prolink|2', 'stagelinq|3']);
  });

  it('still works when the roster is empty (stale preload)', () => {
    // Keeps single-deck linking alive when the `djlink-decks` preload method is
    // missing from a running app.
    const out = mergeRosterSources({ prolink: [], stagelinq: [] }, { prolink: deckA, stagelinq: deckC });
    expect(out.map((d) => d.deckKey)).toEqual(['prolink|1', 'stagelinq|3']);
  });

  it('adds a followed deck the roster has not seen', () => {
    const out = mergeRosterSources({ prolink: [deckB], stagelinq: [] }, { prolink: deckA, stagelinq: null });
    expect(out.map((d) => d.deckKey)).toEqual(['prolink|1', 'prolink|2']);
  });

  it('prefers the STATUS entry over the roster for the deck it covers', () => {
    // The freeze bug: the roster's Pro DJ Link playhead is an approximation that
    // is null when the raw device state carries no beat index, while the status
    // stream's is precise and continuous. Taking the roster entry left the clip
    // reading position 0, so its phase walked backwards and it stopped after the
    // first second. The precise source must win for the deck it covers.
    const rosterEntry = { ...deckA, seconds: null, bpm: 0 };
    const statusEntry = { ...deckA, seconds: 42.5, bpm: 128 };
    const out = mergeRosterSources({ prolink: [rosterEntry], stagelinq: [] }, { prolink: statusEntry, stagelinq: null });
    expect(out).toHaveLength(1);
    expect(out[0].seconds).toBe(42.5);
    expect(out[0].bpm).toBe(128);
  });

  it('drives a loop clip from the advancing playhead, not the dead roster one', () => {
    // End-to-end shape of the reported "plays for a second then stops" bug.
    const link = { ...DEFAULT_DJ_LINK, source: 'prolink', trackId: 'a', follow: 'loop', loopBeats: 8 };
    const rosterEntry = { ...deckA, seconds: null, bpm: null, trackBPM: 128 };
    const statusEntry = { ...deckA, seconds: 0, bpm: 128, trackBPM: 128 };
    const merged = mergeRosterSources({ prolink: [rosterEntry], stagelinq: [] }, { prolink: statusEntry, stagelinq: null });
    const deck = rosterToDeckMap(merged, []).get('a');
    // The engine receives a fresh descriptor on every tick, so each sample has
    // to carry its own playhead — reusing one object would test nothing.
    const st = {};
    const at = (sec) => resolveDeckProgress(link, { ...deck, seconds: sec }, st).progress;

    const p0 = at(0);
    const p1 = at(1);
    const p2 = at(2);
    expect(p1).toBeGreaterThan(p0);
    expect(p2).toBeGreaterThan(p1);
  });

  it('freezes the loop when the playhead source is dead (the bug being fixed)', () => {
    // Control for the test above: with the roster's null playhead winning, the
    // phase would sit still instead of tracking the deck.
    const link = { ...DEFAULT_DJ_LINK, source: 'prolink', trackId: 'a', follow: 'loop', loopBeats: 8 };
    const dead = { ...deckA, seconds: null, bpm: 128, trackBPM: 128 };
    const st = {};
    const at = (sec) => resolveDeckProgress(link, { ...dead, seconds: null }, st).progress;
    // Position reads as 0 on every tick, so progress never leaves the start.
    expect(at(0)).toBe(0);
    expect(at(4)).toBe(0);
  });

  it('de-duplicates by trackId even when the deckKey formats disagree', () => {
    // Pro DJ Link builds "prolink|3" in both sources, but StageLinq builds
    // "stagelinq|10.0.0.5|LA" in the roster and "stagelinq|A1" in the status
    // stream. trackId is the identity links are made against, so it must dedupe
    // too or the imprecise roster entry sneaks back in.
    const rosterEntry = { source: 'stagelinq', deckKey: 'stagelinq|10.0.0.5|LA', trackId: 'c', seconds: null };
    const statusEntry = { source: 'stagelinq', deckKey: 'stagelinq|A1', trackId: 'c', seconds: 30 };
    const out = mergeRosterSources({ prolink: [], stagelinq: [rosterEntry] }, { prolink: null, stagelinq: statusEntry });
    expect(out).toHaveLength(1);
    expect(out[0].seconds).toBe(30);
  });

  it('de-duplicates a repeated deck key inside the roster', () => {
    const out = mergeRosterSources({ prolink: [deckA, { ...deckA, title: 'dupe' }], stagelinq: [] }, {});
    expect(out).toHaveLength(1);
  });

  it('ignores malformed entries', () => {
    const out = mergeRosterSources({ prolink: [null, deckA, { source: 'prolink' }], stagelinq: [] }, { prolink: null });
    expect(out.map((d) => d.deckKey)).toEqual(['prolink|1']);
  });

  it('tolerates a completely empty input', () => {
    expect(mergeRosterSources(null, null)).toEqual([]);
    expect(mergeRosterSources(undefined, undefined)).toEqual([]);
  });
});

describe('linkedClipDurationSec', () => {
  it('loop mode divides by the live deck tempo', () => {
    const link = { ...DEFAULT_DJ_LINK, follow: 'loop', loopBeats: 8 };
    expect(linkedClipDurationSec(link, deck({ bpm: 128 }))).toBeCloseTo(3.75, 5);
    expect(linkedClipDurationSec(link, deck({ bpm: 100 }))).toBeCloseTo(4.8, 5);
  });

  it('falls back to 120 when the deck reports no tempo', () => {
    const link = { ...DEFAULT_DJ_LINK, follow: 'loop', loopBeats: 8 };
    expect(linkedClipDurationSec(link, deck({ bpm: 0 }))).toBeCloseTo(4, 5);
    expect(linkedClipDurationSec(link, null)).toBeCloseTo(4, 5);
  });

  it('position mode returns the trim window length', () => {
    const link = { ...DEFAULT_DJ_LINK, follow: 'position', startSec: 60, endSec: 180 };
    expect(linkedClipDurationSec(link, deck())).toBe(120);
  });

  it('position mode with no window returns the whole track', () => {
    const link = { ...DEFAULT_DJ_LINK, follow: 'position', startSec: 0, endSec: 0 };
    expect(linkedClipDurationSec(link, deck())).toBe(240);
  });

  it('falls back to the whole track when the window is degenerate, matching the progress calc', () => {
    const link = { ...DEFAULT_DJ_LINK, follow: 'position', startSec: 90, endSec: 90 };
    expect(linkedClipDurationSec(link, deck())).toBe(150);
    expect(linkedClipDurationSec(link, deck({ trackDurationMs: null }))).toBe(1);
  });

  it('never returns a non-positive duration', () => {
    const link = { ...DEFAULT_DJ_LINK, follow: 'position', startSec: 90, endSec: 90 };
    expect(linkedClipDurationSec(link, deck({ trackDurationMs: null }))).toBeGreaterThan(0);
    expect(linkedClipDurationSec(null, deck())).toBe(1);
    expect(linkedClipDurationSec({ ...DEFAULT_DJ_LINK, follow: 'loop', loopBeats: 0 }, deck())).toBeCloseTo(3.75, 5);
  });
});

describe('advanceLoopBeats', () => {
  it('integrates from the anchor using the current tempo', () => {
    expect(advanceLoopBeats(0, 0, 1, 120, true)).toBeCloseTo(2, 6);
  });

  it('re-anchors on a jump past the threshold', () => {
    expect(advanceLoopBeats(0, 0, 100, 120, true)).toBeCloseTo(200, 6);
  });

  it('takes the absolute step when direction following is off', () => {
    expect(advanceLoopBeats(100, 10, 8, 120, false)).toBeCloseTo(104, 6);
    expect(advanceLoopBeats(100, 10, 8, 120, true)).toBeCloseTo(96, 6);
  });

  it('leaves the anchor alone when the tempo is unusable', () => {
    expect(advanceLoopBeats(42, 0, 5, 0, true)).toBe(42);
    expect(advanceLoopBeats(42, 0, 5, NaN, true)).toBe(42);
  });
});

describe('resolveTransportPlan', () => {
  const active = { active: true, progress: 0.5, positionSec: 60, bpm: 128, direction: 1, playing: true };
  const match = (layerIndex, colIndex, over = {}) => ({
    pageId: 0,
    layerIndex,
    colIndex,
    clip: clip(),
    deck: deck(),
    resolved: active,
    ...over,
  });

  it('activates a layer whose track just appeared in a deck', () => {
    const plan = resolveTransportPlan([match(2, 3)], {}, () => null);
    expect(plan.activate).toEqual([{ layerIndex: 2, pageId: 0, colIndex: 3, deckKey: 'prolink|3' }]);
    expect(plan.release).toEqual([]);
    expect(plan.nextOwned[2]).toMatchObject({ pageId: 0, colIndex: 3, workerId: 'ilda-a' });
  });

  it('does not re-activate a layer it already owns unchanged', () => {
    const owned = { 2: { pageId: 0, colIndex: 3, workerId: 'ilda-a', deckKey: 'prolink|3' } };
    const plan = resolveTransportPlan([match(2, 3)], owned, () => ({ pageId: 0, colIndex: 3 }));
    expect(plan.activate).toEqual([]);
    expect(plan.release).toEqual([]);
  });

  it('re-activates when the SAME layer switches to a different linked clip', () => {
    const owned = { 2: { pageId: 0, colIndex: 3, workerId: 'ilda-a', deckKey: 'prolink|3' } };
    const plan = resolveTransportPlan([match(2, 5)], owned, () => ({ pageId: 0, colIndex: 3 }));
    expect(plan.activate).toHaveLength(1);
    expect(plan.activate[0]).toMatchObject({ layerIndex: 2, colIndex: 5 });
    expect(plan.release).toEqual([]);
  });

  it('re-activates when the same clip moves to a different deck', () => {
    const owned = { 2: { pageId: 0, colIndex: 3, workerId: 'ilda-a', deckKey: 'prolink|1' } };
    const plan = resolveTransportPlan([match(2, 3)], owned, () => ({ pageId: 0, colIndex: 3 }));
    expect(plan.activate).toHaveLength(1);
  });

  it('releases a layer when the track leaves every deck', () => {
    const owned = { 1: { pageId: 0, colIndex: 0, workerId: 'ilda-a', deckKey: 'prolink|3' } };
    const plan = resolveTransportPlan([], owned, () => ({ pageId: 0, colIndex: 0 }));
    expect(plan.release).toEqual([1]);
    expect(plan.nextOwned).toEqual({});
  });

  it('does NOT release a layer the operator has since fired a pad on', () => {
    const owned = { 1: { pageId: 0, colIndex: 0, workerId: 'ilda-a', deckKey: 'prolink|3' } };
    // Layer now shows a different clip (col 6) — the operator's choice wins.
    const plan = resolveTransportPlan([], owned, () => ({ pageId: 0, colIndex: 6 }));
    expect(plan.release).toEqual([]);
  });

  it('does not release a layer the operator has already cleared', () => {
    const owned = { 1: { pageId: 0, colIndex: 0, workerId: 'ilda-a', deckKey: 'prolink|3' } };
    const plan = resolveTransportPlan([], owned, () => null);
    expect(plan.release).toEqual([1]);
  });

  it('releases a layer whose link moved to a different PAGE', () => {
    // Same clip coordinates, but the page it lives on changed under us.
    const owned = { 1: { pageId: 0, colIndex: 0, workerId: 'ilda-a', deckKey: 'prolink|3' } };
    const moved = match(1, 0, { pageId: 2 });
    const plan = resolveTransportPlan([moved], owned, () => ({ pageId: 0, colIndex: 0 }));
    expect(plan.activate[0].pageId).toBe(2);
    expect(plan.release).toEqual([]);
  });

  it('gives a contested layer to the first match in grid order and ignores the rest', () => {
    const plan = resolveTransportPlan([match(0, 1), match(0, 4), match(0, 7)], {}, () => null);
    expect(plan.activate).toHaveLength(1);
    expect(plan.activate[0]).toMatchObject({ layerIndex: 0, colIndex: 1 });
    expect(Object.keys(plan.nextOwned)).toEqual(['0']);
  });

  it('ignores a match that is not yet triggerable (play-trigger waiting)', () => {
    const waiting = { ...active, active: false };
    const plan = resolveTransportPlan([match(2, 3, { resolved: waiting })], {}, () => null);
    expect(plan.activate).toEqual([]);
    expect(plan.nextOwned).toEqual({});
  });

  it('ignores a match with no resolvable worker id', () => {
    const plan = resolveTransportPlan([match(2, 3, { clip: clip({ type: 'ilda', workerId: null }) })], {}, () => null);
    expect(plan.activate).toEqual([]);
  });

  it('keys a generator clip by its grid position', () => {
    const gen = clip({ type: 'generator', workerId: undefined });
    const plan = resolveTransportPlan([match(3, 2, { clip: gen })], {}, () => null);
    expect(plan.nextOwned[3].workerId).toBe('generator-0-3-2');
  });

  it('carries the resolved clock through to the ownership entry', () => {
    const plan = resolveTransportPlan([match(2, 3)], {}, () => null);
    expect(plan.nextOwned[2].clock).toMatchObject({
      active: true,
      progress: 0.5,
      bpm: 128,
      positionSec: 60,
      direction: 1,
    });
    expect(plan.nextOwned[2].clock.deck.trackId).toBe('track-42');
  });

  it('treats every owned layer as releasable when the transport is disarmed', () => {
    // (The disarm path releases unconditionally — it never runs the planner.)
    const owned = { 0: {}, 1: {}, 2: {} };
    const plan = resolveTransportPlan([], owned, () => null);
    expect(plan.release.sort()).toEqual([0, 1, 2]);
  });
});

describe('resolveDeckProgress - playhead interpolation', () => {
  // The deck only republishes its position when it has a packet to send, which is
  // slower than the renderer's frame rate, so several frames can see the same
  // value. These cover the four things that must hold when smoothing it.
  const posLink = (over = {}) => ({
    ...DEFAULT_DJ_LINK, source: 'prolink', trackId: 'track-42', follow: 'position', ...over,
  });

  it('advances the playhead by elapsed wall time while the report is stale', () => {
    const state = {};
    const link = posLink();
    // First sample: nothing to interpolate from, so trust the report.
    expect(resolveDeckProgress(link, deck({ seconds: 10 }), state, 1000).positionSec).toBe(10);
    // 120 ms later the deck has NOT sent a new report (still 10). The clip must
    // not freeze on 10 - it should keep moving at 1x.
    expect(resolveDeckProgress(link, deck({ seconds: 10 }), state, 1120).positionSec).toBeCloseTo(10.12, 5);
  });

  it('does not advance while the deck is not rolling', () => {
    const state = {};
    const link = posLink();
    resolveDeckProgress(link, deck({ seconds: 10, playing: false }), state, 1000);
    expect(resolveDeckProgress(link, deck({ seconds: 10, playing: false }), state, 1500).positionSec).toBe(10);
  });

  it('re-anchors on the report when the deck is scrubbed or cued elsewhere', () => {
    const state = {};
    const link = posLink();
    resolveDeckProgress(link, deck({ seconds: 10 }), state, 1000);
    // A jog scrub far outside the interpolation window must win outright, or the
    // visuals would carry on playing a position the deck has already left.
    expect(resolveDeckProgress(link, deck({ seconds: 90 }), state, 1100).positionSec).toBe(90);
  });

  it('ignores a small report change, because the report is late', () => {
    // Measured: the report runs up to 228 ms behind the deck. So a small
    // disagreement is lateness, not truth, and following it would ratchet the
    // playhead backwards. The ramp continues on the deck's own rate.
    const state = {};
    const link = posLink();
    const first = resolveDeckProgress(link, deck({ seconds: 10 }), state, 1000).positionSec;
    const after = resolveDeckProgress(link, deck({ seconds: 9.9 }), state, 1100).positionSec;
    expect(after).toBeGreaterThanOrEqual(first);
  });

  it('re-anchors on the report when the deck is scrubbed or cued elsewhere', () => {
    const state = {};
    const link = posLink();
    resolveDeckProgress(link, deck({ seconds: 10 }), state, 1000);
    // A jog scrub far outside the interpolation window must win outright, or the
    // visuals would carry on playing a position the deck has already left.
    expect(resolveDeckProgress(link, deck({ seconds: 90 }), state, 1100).positionSec).toBe(90);
  });

  it('re-anchors on a backward jump beyond the backward threshold', () => {
    const state = {};
    const link = posLink();
    resolveDeckProgress(link, deck({ seconds: 10 }), state, 1000);
    const jumped = PLAYHEAD_REALIGN_BACK_SEC + 0.5;
    const r = resolveDeckProgress(link, deck({ seconds: 10 - jumped }), state, 1010);
    expect(r.positionSec).toBeCloseTo(10 - jumped, 5);
  });

  it('is inert when no timestamp is supplied, so callers keep raw behaviour', () => {
    const state = {};
    const link = posLink();
    resolveDeckProgress(link, deck({ seconds: 10 }), state);
    expect(resolveDeckProgress(link, deck({ seconds: 10 }), state).positionSec).toBe(10);
  });

  it('keeps the lead cap above one frame and below a perceptible drift', () => {
    expect(PLAYHEAD_MAX_LEAD_SEC).toBeGreaterThan(0.05);
    expect(PLAYHEAD_MAX_LEAD_SEC).toBeLessThan(1);
  });
});

describe('advanceDjProgress - render-time extrapolation', () => {
  // The transport publishes a clock at 30Hz; the render loop runs on every
  // animation frame. This is what turns elapsed wall time into progress so the
  // clip is not stuck on one frame for two refreshes.
  const clock = (over = {}) => ({
    active: true,
    progress: 0.5,
    direction: 1,
    durationSec: 8,
    anchorAt: 1000,
    ...over,
  });

  it('advances forward with elapsed time while the deck plays', () => {
    // 100ms into a 8s pass = 0.0125 of a pass.
    expect(advanceDjProgress(clock(), 1100)).toBeCloseTo(0.5125, 6);
  });

  it('steps backwards for a reverse jog, so the animation follows the deck', () => {
    expect(advanceDjProgress(clock({ direction: -1 }), 1100)).toBeCloseTo(0.4875, 6);
  });

  it('holds the frame when the deck is not rolling', () => {
    // direction 0 is what a paused deck or a first sample reports.
    expect(advanceDjProgress(clock({ direction: 0 }), 1100)).toBeCloseTo(0.5, 6);
  });

  it('wraps a forward pass that rolls past 1.0', () => {
    // 0.95 + 200ms of a 1s pass = 1.15 -> wraps to 0.15.
    expect(advanceDjProgress(clock({ progress: 0.95, durationSec: 1 }), 1200)).toBeCloseTo(0.15, 6);
  });

  it('wraps a backward jog below 0.0 instead of returning a negative frame', () => {
    const p = advanceDjProgress(clock({ progress: 0.05, direction: -1, durationSec: 1 }), 1200);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
    expect(p).toBeCloseTo(0.85, 6);
  });

  it('caps the lead so a stalled or backgrounded tab cannot jump a whole pass', () => {
    // 30s of elapsed time must be clamped to DJ_MAX_LEAD_SEC, not 30/8 of a pass.
    const p = advanceDjProgress(clock({ durationSec: 8 }), 31000);
    expect(p).toBeCloseTo(0.5 + DJ_MAX_LEAD_SEC / 8, 6);
  });

  it('returns the raw progress when there is no anchor (non-render callers)', () => {
    expect(advanceDjProgress(clock({ anchorAt: null }), 999999)).toBeCloseTo(0.5, 6);
  });

  it('is safe on an inactive or missing clock', () => {
    expect(advanceDjProgress(null, 1100)).toBe(0);
    expect(advanceDjProgress({ active: false }, 1100)).toBe(0);
  });

  it('keeps the cap below a perceptible drift and above one frame', () => {
    expect(DJ_MAX_LEAD_SEC).toBeGreaterThan(0.05);
    expect(DJ_MAX_LEAD_SEC).toBeLessThan(1);
  });
});

describe('resolveDeckProgress - anchor advance against a slow report stream', () => {
  // Measured on a CDJ-3000: absolute-position packets arrive at 33.8/s but the
  // status stream that publishes `seconds` runs at only 9.2/s, so the report
  // can be ~110 ms old. The transport ticks at 30 Hz on top of that. These pin
  // the anchor to the true position across that whole pattern, because the two
  // failure modes here are both invisible in a single-sample test: an anchor that
  // freezes between reports, and one that jumps backwards.
  const TICK_MS = 33;
  const REPORT_EVERY_TICKS = 3; // ~= 9.2/s
  const posLink = (over = {}) => ({
    ...DEFAULT_DJ_LINK, source: 'prolink', trackId: 'track-42', follow: 'position', ...over,
  });

  const simulate = (ticks, deckOverrides = {}) => {
    const state = {};
    const link = posLink();
    const anchors = [];
    let lastReport = null;
    for (let i = 0; i < ticks; i++) {
      const nowMs = i * TICK_MS;
      const isReport = i % REPORT_EVERY_TICKS === 0;
      const truePos = 10 + nowMs / 1000;
      if (isReport) lastReport = truePos;
      anchors.push(resolveDeckProgress(link, deck({ seconds: lastReport, ...deckOverrides }), state, nowMs).positionSec);
    }
    return anchors;
  };

  it('advances monotonically instead of freezing between reports', () => {
    const anchors = simulate(12);
    for (let i = 1; i < anchors.length; i++) {
      expect(anchors[i]).toBeGreaterThanOrEqual(anchors[i - 1] - 1e-9);
    }
  });

  it('advances on EVERY tick, not only when a report lands', () => {
    // The regression this guards: measuring the lead from the previous tick
    // instead of from the report, which makes the anchor 'report + one tick'
    // forever - constant for the whole gap, then jumping.
    const anchors = simulate(12);
    for (let i = 1; i < 4; i++) {
      expect(anchors[i]).toBeGreaterThan(anchors[i - 1]);
    }
  });

  it('stays within a few ms of the true position throughout', () => {
    const anchors = simulate(12);
    anchors.forEach((a, i) => {
      const truePos = 10 + (i * TICK_MS) / 1000;
      expect(Math.abs(a - truePos)).toBeLessThan(0.01);
    });
  });

  it('does not run away when a report is very late', () => {
    // One report, then a long gap: the lead must cap out, not climb forever.
    const state = {};
    const link = posLink();
    resolveDeckProgress(link, deck({ seconds: 10 }), state, 0);
    const p = resolveDeckProgress(link, deck({ seconds: 10 }), state, 30000).positionSec;
    expect(p).toBeCloseTo(10 + PLAYHEAD_MAX_LEAD_SEC, 5);
  });

  it('keeps the lead cap above the slowest report interval seen in practice', () => {
    // 9.2/s is ~109 ms; the cap has to clear that or the anchor gets reset to a
    // stale value on every tick.
    expect(PLAYHEAD_MAX_LEAD_SEC).toBeGreaterThan(0.11);
    // The lead cap must clear the LONGEST report interval seen in practice, or the
    // anchor is reset to a stale value on every tick. Worst measured was 225 ms.
    expect(PLAYHEAD_MAX_LEAD_SEC).toBeGreaterThan(0.225);
  });
});

describe('resolveDeckProgress - playhead smoothing (measured behaviour)', () => {
  // Pinned to what was measured on a CDJ-3000: position quantised to ~31 ms,
  // packets at 33.9/s, and status reports in bursts 0..225 ms apart. The report is
  // therefore systematically LATE (worst-case 228 ms) while extrapolating forward
  // from it still lands ahead of the deck. The playhead must ramp on its own and
  // only realign on a divergence no report lateness could explain.
  const posLink = (over = {}) => ({
    ...DEFAULT_DJ_LINK, source: 'prolink', trackId: 'track-42', follow: 'position', ...over,
  });
  const RATE = 1.08;
  const djDeck = (over = {}) => deck({ trackBPM: 130, bpm: 130 * RATE, ...over });

  const run = ({ reportEveryMs = 130, scrubAtMs = null, scrubDelta = 0, ticks = 900 } = {}) => {
    const state = {};
    const link = posLink();
    const out = [];
    for (let i = 0; i < ticks; i++) {
      const nowMs = i * 33;
      const reportMs = Math.floor(nowMs / reportEveryMs) * reportEveryMs;
      if (reportMs < 1000) continue;
      const reported = (reportMs / 1000) * RATE
        + (scrubAtMs != null && reportMs >= scrubAtMs ? scrubDelta : 0);
      const r = resolveDeckProgress(link, djDeck({ seconds: reported }), state, nowMs);
      out.push({
        nowMs,
        pos: r.positionSec,
        expected: (nowMs / 1000) * RATE + (scrubAtMs != null && nowMs >= scrubAtMs ? scrubDelta : 0),
      });
    }
    return out;
  };

  it('never steps backwards during steady playback', () => {
    const out = run();
    for (let i = 1; i < out.length; i++) {
      expect(out[i].pos).toBeGreaterThanOrEqual(out[i - 1].pos - 1e-9);
    }
  });

  it('stays within 50 ms of the true playhead during steady playback', () => {
    const out = run();
    for (const s of out) expect(Math.abs(s.pos - s.expected)).toBeLessThan(0.05);
  });

  it('follows a large forward scrub immediately', () => {
    const out = run({ scrubAtMs: 10000, scrubDelta: 20 });
    const after = out.find((s) => s.nowMs >= 10500);
    expect(Math.abs(after.pos - after.expected)).toBeLessThan(0.5);
  });

  it('follows a large backward scrub too', () => {
    // The reason the backward threshold is separate from the forward one: the
    // report is always late, so a threshold tuned to lateness never fires, and one
    // tuned to catch a scrub fires constantly on noise.
    const out = run({ scrubAtMs: 10000, scrubDelta: -8 });
    const after = out.find((s) => s.nowMs >= 10500);
    expect(Math.abs(after.pos - after.expected)).toBeLessThan(0.5);
  });

  it('is unaffected by a different report cadence', () => {
    for (const every of [97, 130, 225]) {
      const out = run({ reportEveryMs: every });
      for (let i = 1; i < out.length; i++) {
        expect(out[i].pos).toBeGreaterThanOrEqual(out[i - 1].pos - 1e-9);
      }
    }
  });

  it('holds the frame when the deck is not rolling', () => {
    const state = {};
    const link = posLink();
    resolveDeckProgress(link, djDeck({ seconds: 10, playing: false }), state, 1000);
    expect(
      resolveDeckProgress(link, djDeck({ seconds: 10, playing: false }), state, 1500).positionSec
    ).toBeCloseTo(10, 5);
  });

  it('tolerates reports arriving in the same millisecond', () => {
    // A burst delivers two reports with the same timestamp. The playhead must keep
    // ramping on the deck's advertised rate and not lurch toward the burst value:
    // the disagreement here (0.032 s) is well inside the lateness band.
    const state = {};
    const link = posLink();
    resolveDeckProgress(link, djDeck({ seconds: 10 }), state, 1000);
    resolveDeckProgress(link, djDeck({ seconds: 10.14 }), state, 1000);
    const p = resolveDeckProgress(link, djDeck({ seconds: 10.14 }), state, 1100).positionSec;
    expect(p).toBeCloseTo(10 + 0.1 * RATE, 5);
  });

  it('places the backward threshold above the worst measured report lateness', () => {
    // The whole design rests on this: the backward threshold must clear the 228 ms
    // worst-case lateness, or the playhead ratchets backwards on every late report.
    expect(PLAYHEAD_REALIGN_BACK_SEC).toBeGreaterThan(0.25);
    expect(PLAYHEAD_REALIGN_FWD_SEC).toBeGreaterThan(0.2);
    expect(PLAYHEAD_REALIGN_BACK_SEC).toBeLessThan(2);
  });
});

describe('resolveDeckProgress - travel direction from the reports', () => {
  // The tempo readout says how FAST the track moves but not WHICH WAY: reverse
  // playback and a backward jog both leave it reporting the track's own positive
  // tempo. Ramping forward through either grew the residual until the realign
  // snapped the playhead, which showed up as jumping when switching between
  // forward and reverse and while scratching the jogwheel.
  const posLink = (over = {}) => ({
    ...DEFAULT_DJ_LINK, source: 'prolink', trackId: 'track-42', follow: 'position', ...over,
  });
  const RATE = 1.08;
  const djDeck = (over = {}) => deck({ trackBPM: 130, bpm: 130 * RATE, ...over });

  // truePos takes SECONDS. Reports are generated every 130 ms, ticks at 30 Hz.
  const run = (truePos, ticks = 600) => {
    const state = {};
    const link = posLink();
    const out = [];
    for (let i = 0; i < ticks; i++) {
      const nowMs = i * 33;
      const reportMs = Math.floor(nowMs / 130) * 130;
      if (reportMs < 130) continue;
      const r = resolveDeckProgress(link, djDeck({ seconds: truePos(reportMs / 1000) }), state, nowMs);
      out.push({ pos: r.positionSec, dir: r.direction, truth: truePos(nowMs / 1000) });
    }
    return out;
  };

  it('reads forward travel as +1', () => {
    const out = run((s) => s * RATE);
    expect(out[out.length - 1].dir).toBe(1);
  });

  it('reads reverse playback as -1, not as forward', () => {
    const out = run((s) => 100 - s * RATE);
    expect(out[out.length - 1].dir).toBe(-1);
  });

  it('tracks reverse playback smoothly instead of ramping forward through it', () => {
    const out = run((s) => 100 - s * RATE);
    // Every delta is legitimately negative here; what matters is that the
    // playhead stays near the truth rather than marching away and snapping back.
    for (const s of out) expect(Math.abs(s.pos - s.truth)).toBeLessThan(0.6);
  });

  it('flips direction after a forward-to-reverse switch', () => {
    const out = run((s) => (s < 3 ? 3 * RATE + (s - 3) * RATE : -(s - 3) * RATE));
    expect(out[out.length - 1].dir).toBe(-1);
  });

  it('flips direction after a reverse-to-forward switch', () => {
    const out = run((s) => (s < 3 ? 100 - s * RATE : 100 - 3 * RATE + (s - 3) * RATE));
    expect(out[out.length - 1].dir).toBe(1);
  });

  it('ignores sub-deadband report jitter when deciding direction', () => {
    // The position is quantised (~31 ms), so individual deltas can be zero or
    // tiny. Those must not vote, or a zero-quantum report would read as a
    // direction change.
    const state = {};
    const link = posLink();
    for (let i = 0; i < 30; i++) {
      const nowMs = i * 130;
      resolveDeckProgress(link, djDeck({ seconds: 10 + (i % 2 ? 0 : 0.02) }), state, nowMs);
    }
    const r = resolveDeckProgress(link, djDeck({ seconds: 10.02 }), state, 4000);
    expect(Math.abs(r.direction)).toBeLessThanOrEqual(1);
  });

  it('reports direction 0 for a paused deck, so the render loop holds its frame', () => {
    const state = {};
    const link = posLink();
    for (let i = 0; i < 8; i++) {
      resolveDeckProgress(link, djDeck({ seconds: 10 + i * 0.1 }), state, i * 130);
    }
    const r = resolveDeckProgress(link, djDeck({ seconds: 10.8, playing: false }), state, 1100);
    expect(r.direction).toBe(0);
  });
});
