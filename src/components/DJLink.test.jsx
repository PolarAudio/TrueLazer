import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import DJLink from './DJLink';
import { DJLINK_TRACK_MIME, deckDescriptorFromSnapshot } from '../utils/djLinkTracks';

/**
 * Render smoke tests for the DJ-Link display.
 *
 * `renderToStaticMarkup` does not run effects, so the IPC subscriptions are
 * inert here — which is what makes this cheap. The point is the DEFAULT state:
 * with no deck reporting, `s` is EMPTY and `link` is null for the default
 * 'tap' source, so every field access has to survive that. That is the same
 * "read a property before the null guard" shape that broke the Clip Settings
 * panel, and it is invisible to the pure-logic tests.
 */

const render = (source, props = {}) =>
  renderToStaticMarkup(React.createElement(DJLink, { source, ...props }));

describe('DJLink — no deck reporting', () => {
  it('renders the default (tap) source without throwing', () => {
    expect(() => render('tap')).not.toThrow();
    const html = render('tap');
    expect(html).toContain('link-display');
    expect(html).toContain('No deck');
    expect(html).toContain('--:--');
  });

  it('renders ProDJ and StageLinq sources with no deck connected', () => {
    expect(render('prolink')).toContain('ProDJ');
    expect(render('stagelinq')).toContain('StLinq');
    expect(render('prolink')).toContain('No deck');
  });

  it('shows the empty title/artist placeholders', () => {
    const html = render('prolink');
    expect(html).toContain('link-track-info');
    expect(html).toContain('>—<');
  });

  it('is not draggable and says why', () => {
    const html = render('prolink');
    expect(html).not.toContain('draggable="true"');
    expect(html).toContain('not-linkable');
    expect(html).toContain('No deck is reporting a loaded track');
  });

  it('explains what to do when no deck is reporting', () => {
    // With no deck at all there is nothing to link, and the tooltip has to say
    // what to fix rather than leaving the field mysteriously inert.
    const html = render('tap');
    expect(html).toContain('No deck is reporting a loaded track');
    expect(html).toContain('Start a Pro DJ Link or StageLinq listener');
  });

  it('is clickable only when there is something to link', () => {
    expect(render('prolink')).not.toContain('role="button"');
    expect(render('prolink')).not.toContain('tabindex="0"');
  });

  it('carries the drag tooltip once, on the field itself', () => {
    // The tooltip moved from .link-title / .link-artist onto the wrapper when it
    // became the drag handle — it must not be duplicated on the inner elements.
    const html = render('prolink');
    const occurrences = html.split('No deck is reporting a loaded track').length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('DJLink — deck selection is not gated on the BPM source', () => {
  // The regression that made the feature unusable: `draggable` was derived from
  // `bpmSource`, which defaults to 'tap'. With no protocol selected the field was
  // draggable={false} and Chromium did a plain text drag that dropped nowhere.
  // The linking decision must consider whichever protocol has a track loaded,
  // whatever the show tempo is following.
  it('is inert with no decks, for every source including tap', () => {
    for (const src of ['tap', 'tcnet', 'prolink', 'stagelinq']) {
      expect(render(src)).toContain('not-linkable');
      expect(render(src)).not.toContain('draggable="true"');
    }
  });

  it('never marks a field linkable without a real track id', () => {
    // Guards the specific failure mode: draggable=true with an unusable payload
    // would start a drag that then refuses the drop. Matched as a whole class
    // token, because "not-linkable" contains "linkable" as a substring.
    for (const src of ['tap', 'tcnet', 'prolink', 'stagelinq']) {
      const html = render(src);
      expect(html).toMatch(/class="link-track-info[^"]*\blinkable\b/);
      expect(html).not.toContain('draggable="true"');
      expect(html).not.toContain('role="button"');
    }
  });
});

describe('DJLink — drag payload identity', () => {
  it('uses the snapshot trackId, matching the deck roster key', () => {
    const snap = {
      playerId: '3',
      playing: true,
      seconds: 10,
      duration: 240,
      title: 'Song',
      artist: 'Artist',
      trackLoaded: true,
      trackId: 42,
      trackKey: '3:1:42',
      deckColor: '#ff3b30',
    };
    const d = deckDescriptorFromSnapshot('prolink', snap);
    expect(d.trackId).toBe('42');
    expect(JSON.parse(JSON.stringify({ t: d.trackId })).t).toBe('42');
    expect(d.trackKey).toBe('3:1:42');
  });

  it('exposes a distinct drag MIME so it cannot be read as an effect/DAC drop', () => {
    expect(DJLINK_TRACK_MIME).not.toBe('application/json');
  });
});
