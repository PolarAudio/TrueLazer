import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import LinkSyncSettingsWindow from './LinkSyncSettingsWindow';

/**
 * Render smoke tests for the Link/Sync settings window, focused on the DJ-Link
 * Clip Transport section.
 *
 * Two things are covered:
 *
 *  1. Both `show` states render. App.jsx mounts this component permanently and
 *     toggles `show`, so the `return null` guard MUST sit after every hook —
 *     before the hooks, opening the window changes the hook count 0 -> 6 and
 *     React throws. Each `renderToStaticMarkup` call is its own root, so it
 *     cannot observe that violation directly; what it does verify is that
 *     BOTH states are renderable at all, which is the precondition.
 *  2. The Clip Transport section degrades safely when the parent passes a
 *     partial `djLinkTransport`, rather than throwing on `.includes`.
 */

const base = {
  onClose: vi.fn(),
  onUpdateSettings: vi.fn(),
  bpmSource: 'prolink',
  onBpmSourceChange: vi.fn(),
};

const render = (props) =>
  renderToStaticMarkup(React.createElement(LinkSyncSettingsWindow, { ...base, ...props }));

const deck = (over = {}) => ({
  source: 'prolink',
  deckId: '3',
  deckKey: 'prolink|3',
  deckColor: '#ff3b30',
  isMaster: true,
  playing: true,
  loaded: true,
  trackId: '42',
  title: 'Test Track',
  artist: 'Test Artist',
  trackDurationMs: 240000,
  bpm: 128,
  seconds: 62,
  ...over,
});

describe('LinkSyncSettingsWindow — visibility', () => {
  it('renders nothing when hidden', () => {
    expect(render({ show: false })).toBe('');
  });

  it('renders the window when shown', () => {
    const html = render({ show: true });
    expect(html).toContain('Link/Sync');
    expect(html).toContain('DJ-Link Clip Transport');
  });
});

describe('LinkSyncSettingsWindow — Clip Transport section', () => {
  it('shows the master arm and its state', () => {
    expect(render({ show: true, djLinkTransport: { enabled: false, blockedDecks: [] } })).toContain('Disarmed');
    expect(render({ show: true, djLinkTransport: { enabled: true, blockedDecks: [] } })).toContain('Armed');
  });

  it('defaults to disarmed when the prop is omitted', () => {
    expect(render({ show: true })).toContain('Disarmed');
  });

  it('does not throw on a partial djLinkTransport with no blockedDecks', () => {
    expect(() => render({ show: true, djLinkTransport: { enabled: true } })).not.toThrow();
  });

  it('prompts the operator to start a listener when no decks report', () => {
    expect(render({ show: true, djLinkDecks: [] })).toContain('No decks reporting');
  });

  it('lists each deck with its transport state and link count', () => {
    const html = render({
      show: true,
      djLinkDecks: [deck(), deck({ deckId: '1', deckKey: 'prolink|1', title: null, loaded: true })],
      djLinkLinkedCountForDeck: (key) => (key === 'prolink|3' ? 3 : 0),
    });
    expect(html).toContain('Test Track');
    expect(html).toContain('Track (no metadata yet)');
    expect(html).toContain('3 clips');
    expect(html).toContain('0 clips');
    expect(html).toContain('playing');
    expect(html).toContain('128 BPM');
  });

  it('reports a stopped deck as stopped', () => {
    const html = render({ show: true, djLinkDecks: [deck({ playing: false, loaded: false, title: null, bpm: 0 })] });
    expect(html).toContain('stopped');
    expect(html).toContain('No track loaded');
  });

  it('offers Disarm for an armed deck with linked clips', () => {
    const html = render({
      show: true,
      djLinkDecks: [deck()],
      djLinkTransport: { enabled: true, blockedDecks: [] },
      djLinkLinkedCountForDeck: () => 2,
    });
    expect(html).toContain('title="Disarm this deck"');
    expect(html).not.toContain('title="Arm this deck"');
  });

  it('offers Arm for a deck that has been disarmed', () => {
    const html = render({
      show: true,
      djLinkDecks: [deck()],
      djLinkTransport: { enabled: true, blockedDecks: ['prolink|3'] },
      djLinkLinkedCountForDeck: () => 2,
    });
    expect(html).toContain('title="Arm this deck"');
    expect(html).not.toContain('title="Disarm this deck"');
  });

  it('disables the per-deck toggle for a deck no clip is linked to', () => {
    const html = render({
      show: true,
      djLinkDecks: [deck()],
      djLinkTransport: { enabled: true, blockedDecks: [] },
      djLinkLinkedCountForDeck: () => 0,
    });
    expect(html).toContain('title="No clips are linked to this deck"');
  });

  it('normalises a Denon #AARRGGBB deck colour for CSS', () => {
    const html = render({
      show: true,
      djLinkDecks: [deck({ source: 'stagelinq', deckColor: '#ffea2828' })],
      djLinkLinkedCountForDeck: () => 1,
    });
    expect(html).toContain('background:#ea2828');
  });

  it('rejects a malformed deck colour rather than emitting invalid CSS', () => {
    const html = render({
      show: true,
      djLinkDecks: [deck({ deckColor: 'chartreuse' })],
      djLinkLinkedCountForDeck: () => 1,
    });
    expect(html).not.toContain('chartreuse');
  });
});
