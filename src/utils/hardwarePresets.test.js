import { describe, it, expect } from 'vitest';
import { resolvePointBudget, resolveTargetPps, getPreset, DEFAULT_PRESET } from './hardwarePresets';

// The renderer used to hardcode maxPoints: 1000 when calling optimizePoints,
// regardless of the channel's actual PPS. Any channel slower than 30kpps/30fps
// then overran its frame window and got decimated again in the main process.
describe('resolvePointBudget', () => {
    it('divides the preset PPS by the frame rate', () => {
        expect(resolvePointBudget({ ppsPreset: 'fast' }, 30)).toBe(
            Math.round(getPreset('fast').targetPps / 30)
        );
    });

    it('honours an explicit ppsOverride over the preset', () => {
        expect(resolvePointBudget({ ppsPreset: 'fast', ppsOverride: 12000 }, 30)).toBe(400);
    });

    it('uses the channel targetFps when set', () => {
        expect(resolvePointBudget({ ppsOverride: 30000, targetFps: 60 }, 30)).toBe(500);
    });

    it('falls back to the supplied frame rate when the channel has no targetFps', () => {
        expect(resolvePointBudget({ ppsOverride: 30000 }, 25)).toBe(1200);
    });

    it('defaults a bare settings object to the default preset at 30fps', () => {
        expect(resolvePointBudget({}, 30)).toBe(Math.round(getPreset(DEFAULT_PRESET).targetPps / 30));
        expect(resolvePointBudget(null, 30)).toBe(Math.round(getPreset(DEFAULT_PRESET).targetPps / 30));
        expect(resolvePointBudget(undefined, 30)).toBe(Math.round(getPreset(DEFAULT_PRESET).targetPps / 30));
    });

    it('never returns zero or a negative budget', () => {
        expect(resolvePointBudget({ ppsOverride: 0 }, 0)).toBeGreaterThanOrEqual(1);
        expect(resolvePointBudget({ ppsOverride: -5 }, 30)).toBeGreaterThanOrEqual(1);
        expect(resolvePointBudget({ ppsOverride: 1000, targetFps: 360 }, 30)).toBe(3);
    });

    it('agrees with resolveTargetPps on the PPS it budgets from', () => {
        const settings = { ppsPreset: 'slow' };
        expect(resolvePointBudget(settings, 30))
            .toBe(Math.round(resolveTargetPps({ preset: settings.ppsPreset }) / 30));
    });
});