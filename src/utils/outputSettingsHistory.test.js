import { describe, it, expect } from 'vitest';
import {
    createHistory,
    pushHistory,
    undoHistory,
    redoHistory,
    cloneOutputSettings,
    outputSettingsEqual,
    shouldCoalesceEdit,
    HISTORY_LIMIT,
    EDIT_COALESCE_MS,
} from './outputSettingsHistory';

const settings = (overrides = {}) => ({
    name: '',
    safetyZones: [],
    outputArea: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    transformationEnabled: false,
    testLineY: 0.5,
    ...overrides,
});

describe('cloneOutputSettings', () => {
    it('copies zones and the output area so snapshots stay immutable', () => {
        const original = settings({ safetyZones: [{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }] });
        const copy = cloneOutputSettings(original);

        copy.safetyZones[0].x = 0.9;
        copy.outputArea.w = 0.1;

        expect(original.safetyZones[0].x).toBe(0.4);
        expect(original.outputArea.w).toBe(0.8);
    });
});

describe('outputSettingsEqual', () => {
    it('ignores key order', () => {
        expect(outputSettingsEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    });

    it('detects nested zone and output-area changes', () => {
        expect(outputSettingsEqual(settings(), settings({ outputArea: { x: 0, y: 0, w: 1, h: 1 } }))).toBe(false);
        expect(
            outputSettingsEqual(
                settings({ safetyZones: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] }),
                settings({ safetyZones: [{ x: 0, y: 0, w: 0.2, h: 0.1 }] })
            )
        ).toBe(false);
    });
});

describe('history', () => {
    it('undo restores the state before the change and redo returns to it', () => {
        const history = createHistory();
        const before = settings({ testLineY: 0.5 });
        const after = settings({ testLineY: 0.8 });

        pushHistory(history, before);

        const restored = undoHistory(history, after);
        expect(restored.testLineY).toBe(0.5);

        const reapplied = redoHistory(history, restored);
        expect(reapplied.testLineY).toBe(0.8);
    });

    it('undoes multiple steps in reverse order', () => {
        const history = createHistory();
        const a = settings({ testLineY: 0.1 });
        const b = settings({ testLineY: 0.2 });
        const c = settings({ testLineY: 0.3 });

        pushHistory(history, a);
        pushHistory(history, b);

        const backToB = undoHistory(history, c);
        const backToA = undoHistory(history, backToB);

        expect(backToB.testLineY).toBe(0.2);
        expect(backToA.testLineY).toBe(0.1);
        expect(undoHistory(history, backToA)).toBeNull();
    });

    it('a new edit clears the redo stack', () => {
        const history = createHistory();
        pushHistory(history, settings({ testLineY: 0.1 }));
        undoHistory(history, settings({ testLineY: 0.9 }));
        expect(history.redo).toHaveLength(1);

        pushHistory(history, settings({ testLineY: 0.4 }));
        expect(history.redo).toHaveLength(0);
    });

    it('does not stack identical snapshots', () => {
        const history = createHistory();
        expect(pushHistory(history, settings())).toBe(true);
        expect(pushHistory(history, settings())).toBe(false);
        expect(history.undo).toHaveLength(1);
    });

    it('caps the stack at HISTORY_LIMIT', () => {
        const history = createHistory();
        for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
            pushHistory(history, settings({ testLineY: i / 1000 }));
        }
        expect(history.undo).toHaveLength(HISTORY_LIMIT);
        // Oldest entries are dropped, newest kept.
        expect(history.undo[history.undo.length - 1].testLineY).toBeCloseTo((HISTORY_LIMIT + 9) / 1000);
    });

    it('snapshots do not alias the live document', () => {
        const history = createHistory();
        const live = settings({ safetyZones: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] });
        pushHistory(history, live);

        live.safetyZones[0].x = 0.7;
        const restored = undoHistory(history, live);
        expect(restored.safetyZones[0].x).toBe(0.1);
    });
});

describe('shouldCoalesceEdit', () => {
    it('merges rapid edits to the same field only', () => {
        const last = { key: 'testLineY', time: 1000 };
        expect(shouldCoalesceEdit(last, 'testLineY', 1000 + EDIT_COALESCE_MS - 1)).toBe(true);
        expect(shouldCoalesceEdit(last, 'testLineY', 1000 + EDIT_COALESCE_MS)).toBe(false);
        expect(shouldCoalesceEdit(last, 'gridSize', 1001)).toBe(false);
        expect(shouldCoalesceEdit(null, 'testLineY', 1001)).toBe(false);
    });
});
