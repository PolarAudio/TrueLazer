import { describe, it, expect, afterEach, vi } from 'vitest';
import installInputDiagnostics, {
    installInputDiagnostics as namedInstall,
    scrollbarBandHit,
    reportInputProblem,
} from './inputDiagnostics';

// These tests run in the node environment, so the browser globals the module
// reads are stubbed per test and always restored afterwards.
const withWindow = (value, fn) => {
    const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const previous = globalThis.window;
    globalThis.window = value;
    try {
        return fn();
    } finally {
        if (hadWindow) globalThis.window = previous;
        else delete globalThis.window;
    }
};

afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.window;
});

describe('input diagnostics', () => {
    it('exposes the installer from both the default and named export', () => {
        expect(namedInstall).toBe(installInputDiagnostics);
    });

    it('is a no-op outside a browser, so importing it can never break the bundle', () => {
        // These tests run in the node environment; main.jsx is the only caller
        // and it only ever runs in the renderer.
        expect(typeof window).toBe('undefined');
        const uninstall = installInputDiagnostics();
        expect(typeof uninstall).toBe('function');
        expect(() => uninstall()).not.toThrow();
    });

    it('reports application-level input problems even without an installed probe', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        withWindow({}, () => {
            expect(() => reportInputProblem('stale-selection', 'selection outlived its shape')).not.toThrow();
        });
        expect(warn).toHaveBeenCalledWith('[input] selection outlived its shape');
    });
});

describe('scrollbarBandHit', () => {
    // A 230x500 scroller at the right edge of a 1920 px window with a 15 px
    // gutter on each axis - i.e. the Shape Builder sidebar.
    const scroller = (overrides = {}) => ({
        nodeType: 1,
        offsetWidth: 230,
        offsetHeight: 500,
        clientWidth: 215,
        clientHeight: 485,
        scrollWidth: 215,
        scrollHeight: 1200,
        getBoundingClientRect: () => ({ left: 1690, top: 0, right: 1920, bottom: 500, width: 230, height: 500 }),
        ...overrides,
    });
    const styles = { overflowX: 'hidden', overflowY: 'auto' };

    it('recognises a press on the vertical scrollbar gutter', () => {
        const el = scroller();
        withWindow({ getComputedStyle: () => styles }, () => {
            expect(scrollbarBandHit(el, 1910, 300)).toBe('vertical');
            expect(scrollbarBandHit(el, 1920, 300)).toBe('vertical');
        });
    });

    it('does not flag a press on the content', () => {
        const el = scroller();
        withWindow({ getComputedStyle: () => styles }, () => {
            expect(scrollbarBandHit(el, 1800, 300)).toBeNull();
        });
    });

    it('recognises a press on the horizontal scrollbar gutter', () => {
        const el = scroller({
            overflowX: 'auto', scrollWidth: 400, offsetHeight: 520, clientHeight: 500,
            getBoundingClientRect: () => ({ left: 1690, top: 0, right: 1920, bottom: 520, width: 230, height: 520 }),
        });
        withWindow({ getComputedStyle: () => ({ overflowX: 'auto', overflowY: 'hidden' }) }, () => {
            expect(scrollbarBandHit(el, 1800, 515)).toBe('horizontal');
        });
    });

    it('stays quiet when there is nothing to scroll', () => {
        const el = scroller({ scrollHeight: 400 });
        withWindow({ getComputedStyle: () => styles }, () => {
            expect(scrollbarBandHit(el, 1910, 300)).toBeNull();
        });
    });

    it('never throws on a non-element target', () => {
        expect(scrollbarBandHit(null, 10, 10)).toBeNull();
        expect(scrollbarBandHit({}, 10, 10)).toBeNull();
    });
});
