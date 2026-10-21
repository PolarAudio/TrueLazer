import { describe, it, expect } from 'vitest';
import {
    SHOW_PROJECT_DOCUMENT_KEYS,
    describeUnsavedWork,
    hasUnsavedWork,
    isShowProjectDirty,
    showProjectFingerprint,
    unsavedWorkPrompt,
} from './projectDirty';

const doc = (overrides = {}) => ({
    columns: [{ id: 'c1' }],
    layers: [{ id: 'l1' }],
    clipContents: [['a', 'b']],
    masterIntensity: 1,
    ...overrides,
});

describe('showProjectFingerprint', () => {
    it('ignores the transient parts of the state', () => {
        // A toast, the playback state and the selection change on their own.
        // If they were in the fingerprint, the document would look dirty
        // seconds after it was saved.
        const before = showProjectFingerprint(doc());
        const after = showProjectFingerprint(doc({
            notification: { message: 'Column duplicated.', visible: true },
            isPlaying: true,
            isStopped: false,
            selectedLayerIndex: 3,
            selectedColIndex: 7,
            activeClipIndexes: [1, 2],
            dacs: [{ ip: '10.0.0.5' }],
            ildaFrames: [1, 2, 3],
            theme: 'cyan',
        }));
        expect(after).toBe(before);
    });

    it('changes when the show changes', () => {
        const before = showProjectFingerprint(doc());
        const after = showProjectFingerprint(doc({ masterIntensity: 0.5 }));
        expect(after).not.toBe(before);
    });

    it('is stable for equal documents', () => {
        expect(showProjectFingerprint(doc())).toBe(showProjectFingerprint(doc()));
    });

    it('covers the show: grid, clip content, layer state and routing', () => {
        for (const key of ['columns', 'layers', 'clipContents', 'layerEffects', 'dacOutputSettings']) {
            expect(SHOW_PROJECT_DOCUMENT_KEYS, `missing ${key}`).toContain(key);
        }
    });
});

describe('isShowProjectDirty', () => {
    it('is clean when the document matches the baseline', () => {
        const state = doc();
        const baseline = showProjectFingerprint(state);
        expect(isShowProjectDirty(state, baseline)).toBe(false);
    });

    it('is dirty when the document has changed', () => {
        const baseline = showProjectFingerprint(doc());
        expect(isShowProjectDirty(doc({ masterIntensity: 0.2 }), baseline)).toBe(true);
    });

    it('is dirty when nothing has been saved yet', () => {
        expect(isShowProjectDirty(doc(), null)).toBe(true);
    });

    it('is clean again after the change is undone', () => {
        const baseline = showProjectFingerprint(doc());
        const edited = doc({ masterIntensity: 0.2 });
        expect(isShowProjectDirty(edited, baseline)).toBe(true);
        expect(isShowProjectDirty(doc(), baseline)).toBe(false);
    });
});

describe('unsaved work', () => {
    it('lists only the editors that have work', () => {
        expect(describeUnsavedWork({})).toEqual([]);
        expect(describeUnsavedWork({ showProject: true })).toEqual(['the Show Project']);
        expect(describeUnsavedWork({ showProject: true, shapeBuilder: true }))
            .toEqual(['the Show Project', 'the Shape Builder']);
    });

    it('knows whether there is anything to lose', () => {
        expect(hasUnsavedWork({})).toBe(false);
        expect(hasUnsavedWork({ timeline: true })).toBe(true);
    });

    it('phrases the confirmation the way the app asks elsewhere', () => {
        const prompt = unsavedWorkPrompt({ showProject: true });
        expect(prompt).toContain('the Show Project');
        expect(prompt).toContain('OK - discard it and continue');
        expect(prompt).toContain('Cancel - stay here so you can save first');
    });

    it('joins several editors readably', () => {
        const prompt = unsavedWorkPrompt({ showProject: true, shapeBuilder: true, timeline: true });
        expect(prompt).toContain('the Show Project, the Shape Builder and the Timeline');
    });

    it('says nothing when there is no work', () => {
        expect(unsavedWorkPrompt({})).toBe('');
    });
});
