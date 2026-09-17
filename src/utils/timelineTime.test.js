import { describe, it, expect } from 'vitest';
import {
    beatDuration, snapInterval, snapToGrid, snapDuration,
    timeToPx, pxToTime, formatTimecode, formatClock, formatDuration,
    getTickStep, rulerTicks, beatGridLines, zoomForDuration, clampZoom,
    nextGridTime, prevGridTime, clipBoundaries, nextBoundary, prevBoundary,
} from './timelineTime';

describe('snapping', () => {
    it('beatDuration is 60/bpm', () => {
        expect(beatDuration(120)).toBe(0.5);
        expect(beatDuration(60)).toBe(1);
        expect(beatDuration(0)).toBe(0.5); // guarded default
    });

    it('snapInterval returns 0 for off and fraction of beat otherwise', () => {
        expect(snapInterval('off', { bpm: 120 })).toBe(0);
        expect(snapInterval('beat', { bpm: 120 })).toBe(0.5);
        expect(snapInterval('eighth', { bpm: 120 })).toBe(0.25);
        expect(snapInterval('sixteenth', { bpm: 120 })).toBe(0.125);
        expect(snapInterval('frame', { fps: 30 })).toBeCloseTo(1 / 30);
    });

    it('snapToGrid rounds to the nearest grid point', () => {
        expect(snapToGrid(1.27, 'beat', { bpm: 120 })).toBe(1.5);
        expect(snapToGrid(1.24, 'beat', { bpm: 120 })).toBe(1);
        expect(snapToGrid(1.24, 'off', { bpm: 120 })).toBe(1.24);
        expect(snapToGrid(1.2, 'frame', { fps: 30 })).toBeCloseTo(1 / 30 * 36); // 1.2 s = 36 frames
    });

    it('snapDuration floors at minDuration and keeps grid alignment', () => {
        const { startTime, duration } = snapDuration(1.27, 3.5, 'beat', { bpm: 120 });
        expect(startTime).toBe(1.5);
        expect(duration).toBeCloseTo(2);
        const tooSmall = snapDuration(1.27, 1.28, 'beat', { bpm: 120 });
        expect(tooSmall.duration).toBe(0.1);
    });
});

describe('unit conversions', () => {
    it('time <-> pixel are exact inverses', () => {
        expect(timeToPx(2.5, 50)).toBe(125);
        expect(pxToTime(125, 50)).toBe(2.5);
        expect(pxToTime(0, 50)).toBe(0);
        expect(pxToTime(100, 0)).toBe(0);
    });
});

describe('timecode / clock formatting', () => {
    it('formats HH:MM:SS:FF at 30fps', () => {
        expect(formatTimecode(0)).toBe('00:00:00:00');
        expect(formatTimecode(1.5)).toBe('00:00:01:15');
        expect(formatTimecode(3661.033)).toBe('01:01:01:00');
        expect(formatTimecode(-5)).toBe('00:00:00:00');
    });

    it('formats compact clocks', () => {
        expect(formatClock(65.2)).toBe('01:05');
        expect(formatClock(3661)).toBe('01:01:01');
    });

    it('formats durations for the inspector', () => {
        expect(formatDuration(2.5)).toBe('2.500 s');
        expect(formatDuration(90)).toBe('1:30.000');
    });
});

describe('ruler ticks', () => {
    it('picks a step keeping ticks >= minPx apart', () => {
        expect(getTickStep(100, { minPx: 90 })).toBe(1); // raw = 0.9s
        expect(getTickStep(1000, { minPx: 90 })).toBe(0.1);
        expect(getTickStep(1, { minPx: 90 })).toBe(120); // raw = 90s -> next nice step
    });

    it('generates ticks across the visible range', () => {
        const { step, ticks } = rulerTicks(0, 3, 100, { minPx: 90 });
        expect(step).toBe(1);
        expect(ticks[0].time).toBe(0);
        expect(ticks[ticks.length - 1].time).toBeGreaterThanOrEqual(3);
        // ticks land on exact seconds in this range
        expect(ticks.every(t => Number.isInteger(t.time))).toBe(true);
    });

    it('labels long ranges with clock format when the step reaches 60s+', () => {
        // Very slow zoom (0.01 px/s) -> ticks step every hour
        const { step, ticks } = rulerTicks(0, 4000, 0.01, { minPx: 90 });
        expect(step).toBe(3600);
        expect(ticks[0].label).toBe('00:00'); // starts at 0
        expect(ticks[1]).toMatchObject({ time: 3600, label: '01:00:00' });
    });
});

describe('beat grid', () => {
    it('marks bars every 4 beats at default signature', () => {
        const lines = beatGridLines(0, 3, { bpm: 120 });
        expect(lines.length).toBe(7); // 0..3.0s in 0.5s steps, inclusive
        expect(lines[0].isBarStart).toBe(true);
        expect(lines[0].bar).toBe(1);
        expect(lines[4].bar).toBe(2); // t=2.0s
        expect(lines[4].isBarStart).toBe(true);
    });

    it('respects a 3/4 signature', () => {
        const lines = beatGridLines(0, 3, { bpm: 120, timeSignature: { beats: 3, unit: 4 } });
        const barStarts = lines.filter(l => l.isBarStart);
        expect(barStarts.map(l => l.time)).toEqual([0, 1.5, 3]);
    });
});

describe('zoom helpers', () => {
    it('fits a duration to a width and clamps', () => {
        expect(zoomForDuration(60, 3000)).toBe(50);
        expect(clampZoom(3)).toBe(5);
        expect(clampZoom(5000)).toBe(2000);
        expect(clampZoom(120)).toBe(120);
    });
});

describe('grid navigation', () => {
    it('nextGridTime returns the next strict grid line', () => {
        expect(nextGridTime(0.25, 0.5)).toBe(0.5);
        expect(nextGridTime(0.5, 0.5)).toBe(1.0);
        expect(nextGridTime(0.0, 0.5)).toBe(0.5);
        expect(nextGridTime(3.3, 1)).toBe(4.0);
    });

    it('prevGridTime returns the previous strict grid line, clamped at 0', () => {
        expect(prevGridTime(0.75, 0.5)).toBe(0.5);
        expect(prevGridTime(0.5, 0.5)).toBe(0.0);
        expect(prevGridTime(0.4, 0.5)).toBe(0.0);
        expect(prevGridTime(3.3, 1)).toBe(3.0);
        expect(prevGridTime(0.0, 0.5)).toBe(0.0);
    });

    it('treats a zero/invalid grid as no-op', () => {
        expect(nextGridTime(1.7, 0)).toBe(1.7);
        expect(prevGridTime(1.7, -1)).toBe(0);
    });

    it('collects unique sorted clip boundaries (start and end)', () => {
        const state = {
            cues: {
                a: { startTime: 0, duration: 5 },
                b: { startTime: 2, duration: 3 },
                c: { startTime: 4, duration: 3 },
            },
        };
        expect(clipBoundaries(state)).toEqual([0, 2, 4, 5, 7]);
    });

    it('nextBoundary finds the first boundary after time', () => {
        const bs = [0, 2, 3, 5, 7, 8];
        expect(nextBoundary(bs, 2)).toBe(3);
        expect(nextBoundary(bs, 8.01)).toBeNull();
        expect(nextBoundary([], 1)).toBeNull();
    });

    it('prevBoundary finds the last boundary before time', () => {
        const bs = [0, 2, 3, 5, 7, 8];
        expect(prevBoundary(bs, 3)).toBe(2);
        expect(prevBoundary(bs, 0)).toBeNull();
        expect(prevBoundary([], 5)).toBeNull();
    });
});