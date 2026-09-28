import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Declaration-order guard for the DJ-Link Clip Transport block in App.jsx.
 *
 * A `useCallback` DEPENDENCY ARRAY is evaluated eagerly at the call site, so
 * referencing a component-scope `const` declared further down throws
 * "Cannot access 'X' before initialization" the moment the component renders.
 * Neither `vite build` nor a unit test can catch that: it only happens at
 * runtime, with a live component instance, which no test here can mount (App
 * needs the MIDI / Art-Net / keyboard / audio providers).
 *
 * That is exactly the bug this file shipped with: `linkClipToDeck`'s deps read
 * `djLinkTransport.enabled` while that `useState` sat below it.
 *
 * This is deliberately NOT a general linter — a source scan of a 7,800-line
 * component flags every hook that lives in a sibling component (SidePanelContainer,
 * MasterSpeedSlider, …) and is a false-positive machine. It checks only the
 * handful of names this feature owns, where ordering is a real invariant.
 *
 * App.jsx indents component scope with 4 spaces and function bodies with 8+, so a
 * 4-space `const` is unambiguously component scope in this file.
 */

const APP_PATH = join(dirname(fileURLToPath(import.meta.url)), 'App.jsx');
const source = readFileSync(APP_PATH, 'utf8');
const lines = source.split(/\r?\n/);

/** Component-scope declarations, name -> 1-based line of FIRST declaration. */
function componentScopeDeclarations() {
  const found = new Map();
  lines.forEach((line, i) => {
    // Handles both `const x =` and `const [a, b] =`.
    const plain = line.match(/^ {4}const\s+([A-Za-z_$][\w$]*)\s*=/);
    if (plain && !found.has(plain[1])) found.set(plain[1], i + 1);
    const destructured = line.match(/^ {4}const\s+\[\s*([A-Za-z_$][\w$]*)/);
    if (destructured && !found.has(destructured[1])) found.set(destructured[1], i + 1);
  });
  return found;
}

const decl = componentScopeDeclarations();

/** First component-scope line that mentions `name` outside its declaration. */
function firstComponentScopeUse(name) {
  const re = new RegExp(`\\b${name}\\b`);
  const declLine = decl.get(name);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    if (lineNo === declLine) continue;
    if (!re.test(lines[i])) continue;
    // Component scope only: 4-space indent, and not a comment.
    if (!/^ {4}\S/.test(lines[i])) continue;
    if (/^ {4}(\/\/|\*)/.test(lines[i])) continue;
    return lineNo;
  }
  return Infinity;
}

describe('App.jsx — DJ-Link Clip Transport declaration order', () => {
  it('finds the component-scope declarations this feature owns', () => {
    for (const name of [
      'djLinkTransport',
      'djLinkClockRef',
      'linkClipToDeck',
      'handleLinkDjTrack',
      'handleLinkSongToSelection',
      'handleUpdateDjLink',
      'handleIsDeckArmed',
      'djLinkClipTransport',
    ]) {
      expect(decl.has(name), `${name} should be a component-scope declaration`).toBe(true);
    }
  });

  it('declares the transport state before any use of it', () => {
    // The exact TDZ crash: `linkClipToDeck`'s dependency array and body both read
    // `djLinkTransport.enabled`.
    const declLine = decl.get('djLinkTransport');
    const useLine = firstComponentScopeUse('djLinkTransport');
    expect(useLine, 'djLinkTransport is used at component scope').toBeLessThan(Infinity);
    expect(declLine).toBeLessThan(useLine);
  });

  it.each([
    ['djLinkClockRef', 'processClip reads the clock ref inside the frame loop'],
    ['handleIsDeckArmed', 'the transport hook needs the per-deck disarm check'],
    ['handleDjLinkActivate', 'the transport hook needs its activate callback'],
  ])('declares %s before first use at component scope', (name) => {
    const declLine = decl.get(name);
    const useLine = firstComponentScopeUse(name);
    expect(declLine).toBeLessThan(useLine);
  });

  it('keeps linkClipToDeck ahead of the two route wrappers that call it', () => {
    const helper = decl.get('linkClipToDeck');
    expect(helper).toBeLessThan(decl.get('handleLinkDjTrack'));
    expect(helper).toBeLessThan(decl.get('handleLinkSongToSelection'));
  });

  it('keeps the hook call after everything it consumes', () => {
    const hookLine = decl.get('djLinkClipTransport');
    for (const dep of ['djLinkTransport', 'handleIsDeckArmed', 'handleDjLinkActivate']) {
      expect(hookLine, `${dep} must be declared before the hook`).toBeGreaterThan(decl.get(dep));
    }
  });
});
