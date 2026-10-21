import { describe, it, expect, vi } from 'vitest';
import {
    APP_PAGES,
    PAGE_LABELS,
    PAGES_AT_RISK_ON_NAVIGATION,
    isShowEditorPage,
    normalizePage,
    resolveProjectCommand,
    shouldWarnOnUnsavedChanges,
    commandForKeyEvent,
} from './projectRouting';

// The bug this guards: the application menu accelerators fire on every page, so
// Ctrl+S while on the Timeline used to write a .tlp SHOW file instead of saving
// the timeline. Routing must therefore be decided by page.
describe('resolveProjectCommand', () => {
    const stub = () => ({
        newProject: vi.fn(),
        openProject: vi.fn(),
        saveProject: vi.fn(),
        saveProjectAs: vi.fn(),
    });

    it('leaves the show project to the main process', () => {
        const d = resolveProjectCommand('main', 'save', { timeline: stub(), shapeBuilder: stub() });
        expect(d.owner).toBe('main');
        expect(d.handled).toBe(false);
        expect(d.reason).toBe('main-process');
    });

    it.each(['new', 'open', 'save', 'saveAs'])('routes %s to the timeline', (cmd) => {
        const timeline = stub();
        const d = resolveProjectCommand('timeline', cmd, { timeline, shapeBuilder: stub() });
        expect(d.owner).toBe('timeline');
        expect(d.handled).toBe(true);
        expect(d.run).toBeTypeOf('function');
    });

    it.each(['new', 'open', 'save', 'saveAs'])('routes %s to the Shape Builder', (cmd) => {
        const shapeBuilder = stub();
        const d = resolveProjectCommand('shapeBuilder', cmd, { timeline: stub(), shapeBuilder });
        expect(d.owner).toBe('shapeBuilder');
        expect(d.handled).toBe(true);
    });

    it('calls the matching implementation', () => {
        const timeline = stub();
        resolveProjectCommand('timeline', 'saveAs', { timeline }).run();
        expect(timeline.saveProjectAs).toHaveBeenCalledTimes(1);
        expect(timeline.saveProject).not.toHaveBeenCalled();
    });

    it('does NOT fall back to the show project when a page is unavailable', () => {
        // Falling back would save the wrong document to the wrong file, which is
        // worse than doing nothing.
        for (const page of ['timeline', 'shapeBuilder']) {
            const d = resolveProjectCommand(page, 'save', {});
            expect(d.handled).toBe(false);
            expect(d.owner).toBe(page);
            expect(d.reason).toBe('unavailable');
        }
    });

    it('treats a partially built page implementation as unavailable', () => {
        const partial = { saveProject: vi.fn() }; // no saveProjectAs
        const d = resolveProjectCommand('shapeBuilder', 'saveAs', { shapeBuilder: partial });
        expect(d.handled).toBe(false);
        expect(d.reason).toBe('unavailable');
    });

    it('rejects an unknown command rather than guessing', () => {
        const d = resolveProjectCommand('timeline', 'export-ilda', { timeline: stub() });
        expect(d.handled).toBe(false);
        expect(d.reason).toBe('unknown-command');
    });

    it('falls back to the show editor for an unrecognised page', () => {
        expect(normalizePage('nonsense')).toBe('main');
        expect(isShowEditorPage('nonsense')).toBe(true);
        expect(resolveProjectCommand(undefined, 'save', {}).owner).toBe('main');
    });
});

describe('page metadata', () => {
    it('treats only Show Control as having a clip deck', () => {
        // Layer / Column / Clip menus and the clip-deck View entries are only
        // offered here.
        expect(isShowEditorPage('main')).toBe(true);
        expect(isShowEditorPage('timeline')).toBe(false);
        expect(isShowEditorPage('shapeBuilder')).toBe(false);
    });

    it('names every page it knows about', () => {
        for (const page of APP_PAGES) {
            expect(PAGE_LABELS[page]).toBeTruthy();
        }
    });
});
// The Shape Builder unmounts when its page is left, so unsaved work is lost.
// The Timeline persists to local storage and must NOT nag.
describe('shouldWarnOnUnsavedChanges', () => {
    it('warns when leaving a dirty Shape Builder', () => {
        expect(shouldWarnOnUnsavedChanges('shapeBuilder', 'main', true)).toBe(true);
        expect(shouldWarnOnUnsavedChanges('shapeBuilder', 'timeline', true)).toBe(true);
    });

    it('stays quiet when the Shape Builder is clean', () => {
        expect(shouldWarnOnUnsavedChanges('shapeBuilder', 'main', false)).toBe(false);
    });

    it('does not warn when navigating to the page you are already on', () => {
        expect(shouldWarnOnUnsavedChanges('shapeBuilder', 'shapeBuilder', true)).toBe(false);
    });

    it('does not warn leaving the Timeline, whose store is persisted', () => {
        expect(shouldWarnOnUnsavedChanges('timeline', 'main', true)).toBe(false);
        expect(shouldWarnOnUnsavedChanges('main', 'timeline', true)).toBe(false);
    });

    it('treats an unrecognised page as the show editor (persisted)', () => {
        expect(shouldWarnOnUnsavedChanges('nonsense', 'main', true)).toBe(false);
    });

    it('lists only the page whose document is lost on navigation', () => {
        expect(PAGES_AT_RISK_ON_NAVIGATION).toEqual(['shapeBuilder']);
    });
});

// The menu items carry registerAccelerator: false, so these keys are handled
// in the renderer. Save and new previously did not fire reliably depending on
// what had focus while open did, so the mapping is centralised and tested here.
describe('commandForKeyEvent', () => {
    const k = (key, extra = {}) => ({ key, ctrlKey: true, ...extra });

    it('maps the four commands', () => {
        expect(commandForKeyEvent(k('n'))).toBe('new');
        expect(commandForKeyEvent(k('o'))).toBe('open');
        expect(commandForKeyEvent(k('s'))).toBe('save');
        expect(commandForKeyEvent(k('s', { shiftKey: true }))).toBe('saveAs');
    });

    it('is case insensitive', () => {
        expect(commandForKeyEvent(k('S'))).toBe('save');
        expect(commandForKeyEvent(k('N', { shiftKey: true }))).toBe('new');
    });

    it('accepts Cmd as well as Ctrl, for macOS', () => {
        expect(commandForKeyEvent({ key: 's', metaKey: true })).toBe('save');
    });

it('ignores the keys without a modifier', () => {
        expect(commandForKeyEvent({ key: 's' })).toBeNull();
        expect(commandForKeyEvent({ key: 's', ctrlKey: false, metaKey: false })).toBeNull();
        expect(commandForKeyEvent({ key: 'n' })).toBeNull();
    });

    it('ignores Alt combinations, which are used for AltGr characters', () => {
        expect(commandForKeyEvent(k('s', { altKey: true }))).toBeNull();
        expect(commandForKeyEvent(k('n', { altKey: true }))).toBeNull();
    });

    it('ignores unrelated modified keys', () => {
        for (const key of ['c', 'v', 'z', 'p', 'q', 'ArrowLeft', 'Tab', ' ', 'F5']) {
            expect(commandForKeyEvent(k(key)), key).toBeNull();
        }
    });

    it('is safe with a malformed or empty event', () => {
        expect(commandForKeyEvent(null)).toBeNull();
        expect(commandForKeyEvent(undefined)).toBeNull();
        expect(commandForKeyEvent({})).toBeNull();
        expect(commandForKeyEvent({ key: undefined, ctrlKey: true })).toBeNull();
        expect(commandForKeyEvent({ key: 123, ctrlKey: true })).toBeNull();
    });

    it('does not treat Shift+S as a plain save', () => {
        expect(commandForKeyEvent(k('s', { shiftKey: true }))).not.toBe('save');
    });
});
