import { describe, it, expect } from 'vitest';
import { toFlat8, blankFrame, selectActiveCue, buildGeneratorFrame } from './timelineCompile';

const cue = (patch) => ({
    id: 'c',
    type: 'GENERATOR',
    startTime: 0,
    duration: 5,
    layerPriority: 0,
    isLooping: false,
    generatorId: 'circle',
    generatorParams: {},
    ...patch,
});

describe('canonical frame helpers', () => {
    it('toFlat8 packs object points into 8-float stamped frames', () => {
        const raw = [
            { x: 1, y: 2, r: 255, g: 0, b: 128, lastPoint: false },
            { x: 0, y: 0, r: 0, g: 0, b: 0, blanking: true, lastPoint: true },
        ];
        const f = toFlat8(raw);
        expect(f).toBeInstanceOf(Float32Array);
        expect(f.length).toBe(16);
        expect(f[0]).toBe(1);
        expect(f[6]).toBe(0);
        expect(f[7]).toBe(0);
        expect(f[8 + 3]).toBe(0);
        expect(f[8 + 6]).toBe(1);
        expect(f[8 + 7]).toBe(1);
    });

    it('blankFrame is a single blanked + last-flagged point', () => {
        const b = blankFrame();
        expect(b.length).toBe(8);
        expect(b[6]).toBe(1);
        expect(b[7]).toBe(1);
    });
});

describe('selectActiveCue', () => {
    it('returns null before cue start and after its end', () => {
        const c = cue({ startTime: 2, duration: 3 });
        expect(selectActiveCue([c], 1)).toBeNull();
        expect(selectActiveCue([c], 5.1)).toBeNull();
    });

    it('keeps a looping cue active forever', () => {
        const c = cue({ startTime: 2, duration: 3, isLooping: true });
        expect(selectActiveCue([c], 999)).toBe(c);
    });

    it('picks the higher layerPriority regardless of start order', () => {
        const low = cue({ id: 'low', startTime: 0, layerPriority: 0 });
        const high = cue({ id: 'high', startTime: 1, layerPriority: 5 });
        expect(selectActiveCue([low, high], 2).id).toBe('high');
    });

    it('breaks priority ties with most-recent start', () => {
        const older = cue({ id: 'older', startTime: 0 });
        const newer = cue({ id: 'newer', startTime: 1 });
        expect(selectActiveCue([older, newer], 2).id).toBe('newer');
    });
});

describe('buildGeneratorFrame', () => {
    it('produces a typed circle frame respecting param counts', () => {
        const c = cue({ generatorId: 'circle', generatorParams: { numPoints: 24, radius: 0.5 } });
        const f = buildGeneratorFrame(c);
        expect(f).toBeInstanceOf(Float32Array);
        expect(f.length / 8).toBe(25); // 24 samples + closing point
    });

    it('returns null for unknown / async-only generators', () => {
        expect(buildGeneratorFrame(cue({ generatorId: 'text' }))).toBeNull();
        expect(buildGeneratorFrame(cue({ generatorId: 'not-a-gen' }))).toBeNull();
    });
});