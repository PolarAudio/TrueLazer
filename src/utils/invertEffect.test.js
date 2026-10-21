import { describe, it, expect } from 'vitest';
import { applyEffects, applyBoundaryDwell } from './effects';
import { effectDefinitions } from './effectDefinitions';

const frame = (points) => ({
    points: new Float32Array(points.flatMap((p) => [
        p.x ?? 0, p.y ?? 0, 0, p.r ?? 0, p.g ?? 0, p.b ?? 0, p.blanking ? 1 : 0, 0,
    ])),
    isTypedArray: true,
});

const read = (f, i) => ({
    x: f.points[i * 8], y: f.points[i * 8 + 1],
    r: f.points[i * 8 + 3], g: f.points[i * 8 + 4], b: f.points[i * 8 + 5],
    blanking: f.points[i * 8 + 6] === 1,
});

const invert = (params) => [{ id: 'invert', instanceId: 't.invert', params }];

describe('the Invert effect definition', () => {
    const def = effectDefinitions.find((d) => d.id === 'invert');

    it('defaults every option to off', () => {
        // It used to default to inverting X and Y, which meant that asking
        // for an inverted COLOUR also silently mirrored the geometry.
        expect(def.defaultParams.invertX).toBe(false);
        expect(def.defaultParams.invertY).toBe(false);
        expect(def.defaultParams.invertColor).toBe(false);
    });

    it('offers no control for an axis nothing reads', () => {
        // z is not part of any 2D DAC protocol this app speaks: the
        // renderer, the EtherDream writer, the IDN packet and the Showbridge
        // writer all ignore it. The control could only ever be a lie.
        expect(def.paramControls.map((c) => c.id)).not.toContain('invertZ');
    });
});

describe('applyInvert', () => {
    it('inverts the coordinates it is told to', () => {
        const f = frame([{ x: 0.25, y: -0.5, r: 10, g: 20, b: 30 }]);
        const out = applyEffects(f, invert({ invertX: true, invertY: true }));
        expect(read(out, 0).x).toBeCloseTo(-0.25);
        expect(read(out, 0).y).toBeCloseTo(0.5);
    });

    it('inverts the colour', () => {
        const f = frame([{ x: 0, y: 0, r: 10, g: 20, b: 30 }]);
        const out = applyEffects(f, invert({ invertColor: true }));
        expect(read(out, 0).r).toBe(245);
        expect(read(out, 0).g).toBe(235);
        expect(read(out, 0).b).toBe(225);
    });

    it('leaves a pen-up move black', () => {
        // A blanked point is the beam being OFF, not a colour. Inverting it
        // to white made the boundary-dwell pass read it as lit, and the
        // settle samples the scanner needs at a beam toggle were dropped -
        // a galvo overshoot, not a cosmetic issue.
        const f = frame([
            { x: 0, y: 0, r: 200, g: 200, b: 200 },
            { x: 0.5, y: 0, r: 0, g: 0, b: 0, blanking: true },
        ]);
        const out = applyEffects(f, invert({ invertColor: true }));
        expect(read(out, 1).blanking).toBe(true);
        expect(read(out, 1).r).toBe(0);
        expect(read(out, 1).g).toBe(0);
        expect(read(out, 1).b).toBe(0);
    });

    it('keeps a blanked point readable as unlit after the invert', () => {
        // The boundary-dwell pass decides "lit" from the colour and ignores
        // the blanking flag, so this is the property it depends on.
        const f = frame([
            { x: 0, y: 0, r: 200, g: 200, b: 200 },
            { x: 0.5, y: 0, r: 0, g: 0, b: 0, blanking: true },
        ]);
        const out = applyEffects(f, invert({ invertColor: true }));
        const dwell = applyBoundaryDwell(out, 2);
        // A blank transition still has to get its settle samples.
        expect(dwell.points.length / 8).toBeGreaterThan(2);
    });

    it('clamps the inverted colour to the 0..255 frame range', () => {
        const f = frame([{ x: 0, y: 0, r: 300, g: -20, b: 128 }]);
        const out = applyEffects(f, invert({ invertColor: true }));
        expect(read(out, 0).r).toBe(0);
        expect(read(out, 0).g).toBe(255);
        expect(read(out, 0).b).toBe(127);
    });
});
