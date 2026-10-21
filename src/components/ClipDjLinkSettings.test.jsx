import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import ClipDjLinkSettings from './ClipDjLinkSettings';
import { DEFAULT_DJ_LINK } from '../utils/djLinkTracks';

/**
 * Render smoke tests for the DJ-Link Clip Transport panel.
 *
 * There is no DOM test environment in this project (and adding one is not worth
 * a dependency), but `react-dom/server` already ships with react-dom and
 * executes the component body — which is exactly what is needed here. The bug
 * this exists to catch: the panel read `link.follow` BEFORE its `if (!link)`
 * guard, so opening Clip Settings on any clip WITHOUT a song link threw
 * "Cannot read properties of null (reading 'follow')" and took the whole panel
 * down. Pure-logic tests cannot see that; a render does.
 */

const baseProps = {
  uiState: {},
  onUpdate: vi.fn(),
  onUnlink: vi.fn(),
  onUpdateUiState: vi.fn(),
  clock: null,
  transportArmed: true,
  onArmTransport: vi.fn(),
};

const render = (link, extra = {}) =>
  renderToStaticMarkup(
    React.createElement(ClipDjLinkSettings, { ...baseProps, link, ...extra })
  );

const link = (over = {}) => ({
  ...DEFAULT_DJ_LINK,
  source: 'prolink',
  trackId: '42',
  trackKey: '3:1:42',
  title: 'Test Track',
  artist: 'Test Artist',
  deckColor: '#ff3b30',
  trackDurationMs: 240000,
  ...over,
});

const deck = (over = {}) => ({
  source: 'prolink',
  deckId: '3',
  deckKey: 'prolink|3',
  loaded: true,
  trackId: '42',
  title: 'Test Track',
  playing: true,
  bpm: 128,
  seconds: 62,
  trackDurationMs: 240000,
  ...over,
});

describe('ClipDjLinkSettings — unlinked clip', () => {
  it('renders the empty state instead of throwing on a null link', () => {
    expect(() => render(null)).not.toThrow();
    const html = render(null);
    expect(html).toContain('DJ-Link Transport');
    expect(html).toContain('No song linked to this clip yet');
  });

  it('renders the empty state for undefined and for a clip with no binding field', () => {
    expect(() => render(undefined)).not.toThrow();
    expect(render(undefined)).toContain('No song linked to this clip yet');
  });

  it('documents BOTH ways to link, since a drag is not always available', () => {
    const html = render(null);
    // The click route has to be discoverable — it is the one that always works
    // when the cursor cannot manage a drag.
    expect(html).toContain('Drag that song onto this clip');
    expect(html).toContain('click');
    expect(html).toContain('Arm');
    expect(html).toContain('Clip Transport');
  });

  it('does not render transport controls that would need a link', () => {
    const html = render(null);
    expect(html).not.toContain('Trigger');
    expect(html).not.toContain('Follow deck direction');
    expect(html).not.toContain('djlink-readout');
  });
});

describe('ClipDjLinkSettings — linked clip', () => {
  it('renders the linked track chip and the mode controls', () => {
    const html = render(link());
    expect(html).toContain('Test Track');
    expect(html).toContain('Test Artist');
    expect(html).toContain('Unlink');
    expect(html).toContain('Deck Position');
    expect(html).toContain('On Load');
  });

  it('defaults to loop mode and shows the loop length in beats', () => {
    const html = render(link());
    expect(html).toContain('Loop Length (beats)');
    // 8 beats at the fallback 120 BPM = 4.00s
    expect(html).toContain('4.00s per loop');
  });

  it('shows the loop length against the LIVE deck tempo', () => {
    const html = render(link(), { clock: { active: true, deck: deck(), progress: 0.25, positionSec: 62, bpm: 128, direction: 1 } });
    // 8 beats at 128 BPM = 3.75s
    expect(html).toContain('3.75s per loop');
    expect(html).toContain('128 BPM');
  });

  it('shows the trim window in position mode', () => {
    const html = render(link({ follow: 'position', startSec: 60, endSec: 180 }));
    expect(html).toContain('Window');
    expect(html).toContain('2:00 of animation');
    expect(html).not.toContain('Loop Length');
  });

  it('describes a whole-track window when start and end are both zero', () => {
    const html = render(link({ follow: 'position' }));
    expect(html).toContain('Whole track (4:00)');
  });

  it('reflects the play trigger', () => {
    const html = render(link({ trigger: 'play' }));
    expect(html).toContain('On Play');
  });

  it('reports "not driven" while the deck is not driving the clip', () => {
    const html = render(link());
    expect(html).toContain('not driven');
  });

  it('reports live progress and a direction arrow while the deck drives it', () => {
    const html = render(link(), {
      clock: { active: true, deck: deck(), progress: 0.5, positionSec: 62, bpm: 128, direction: -1 },
    });
    expect(html).toContain('50.0%');
    expect(html).toContain('1:02');
    expect(html).toContain('backward');
  });

  it('shows no direction arrow or label while the deck is paused', () => {
    const html = render(link(), {
      clock: { active: true, deck: deck({ playing: false }), progress: 0.5, positionSec: 62, bpm: 128, direction: 0 },
    });
    expect(html).toContain('1:02');
    // The arrow glyph and the direction word, not the string "backward" — which
    // also appears in the follow-direction checkbox's tooltip.
    expect(html).not.toContain('djlink-arrow');
    expect(html).not.toContain('djlink-dir-label');
  });

  it('shows a backward arrow when the deck is jogged backward', () => {
    const html = render(link(), {
      clock: { active: true, deck: deck(), progress: 0.5, positionSec: 62, bpm: 128, direction: -1 },
    });
    expect(html).toContain('djlink-dir-label');
    expect(html).toContain('backward');
  });

  it('warns and offers to arm when Clip Transport is disarmed', () => {
    const html = render(link(), { transportArmed: false });
    expect(html).toContain('disarmed in Link/Sync Settings');
    expect(html).toContain('Arm it');
  });

  it('has no disarm warning when the transport is armed', () => {
    expect(render(link())).not.toContain('disarmed in Link/Sync Settings');
  });

  it('survives a link that is missing every optional field', () => {
    const bare = { enabled: true, trackId: 'x' };
    expect(() => render(bare)).not.toThrow();
    expect(render(bare)).toContain('Loop Length (beats)');
  });

  it('survives a malformed deck colour and a deck reporting no tempo', () => {
    // Malformed colour must not emit a bad CSS colour; no tempo must fall back
    // to the 120 BPM assumption rather than dividing by zero.
    const html = render(link({ deckColor: 'not-a-colour' }), {
      clock: { active: true, deck: deck({ bpm: 0 }), progress: 0.1, positionSec: 0, bpm: 0, direction: 0 },
    });
    expect(html).toContain('10.0%');
    expect(html).toContain('deck tempo unknown');
    expect(html).not.toContain('not-a-colour');
  });

  it('survives a deck with no title, no duration and no tempo', () => {
    const bare = deck({ title: null, trackDurationMs: null, bpm: null, seconds: null });
    expect(() => render(link(), { clock: { active: true, deck: bare, progress: 0, positionSec: 0, bpm: 0, direction: 0 } })).not.toThrow();
  });
});
