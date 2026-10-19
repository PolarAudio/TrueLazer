import { describe, it, expect, vi } from 'vitest';
import {
    APP_PAGES,
    PAGE_LABELS,
    isShowEditorPage,
    normalizePage,
    resolveProjectCommand,
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