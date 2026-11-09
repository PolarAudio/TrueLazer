import { describe, it, expect } from 'vitest';
import { optimizePoints } from './optimizer';
import { applyOutputProcessingWithDwell } from './effects';
import { generateCircle, generateSinewave, generateSquare, generateStar } from './generators';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { decimatePoints } = require('../../main/dac-budget.cjs');

// A vertical band down the middle: every closed shape must cross it.
const ZONE = { safetyZones: [{ x: 0.45, y: 0, w: 0.1, h: 1 }] };
const BUDGET = 575;

function chain(gen, params) {
    const f = gen({ renderingStyle: 'normal', ...params });
    const opt = optimizePoints(f.points, { maxDist: 0.02, pathDwell: 2, maxPoints: BUDGET, isClosed: f.isClosed });
    const proc = applyOutputProcessingWithDwell({ points: opt, isTypedArray: true }, ZONE, 2);
    return decimatePoints(proc.points, BUDGET);
}

function stats(wire) {
    let maxStep = 0;
    for (let i = 1; i < wire.length / 8; i++) {
        if (wire[i * 8 + 6] > 0.5 || wire[(i - 1) * 8 + 6] > 0.5) continue;
        maxStep = Math.max(maxStep, Math.hypot(wire[i * 8] - wire[(i - 1) * 8], wire[i * 8 + 1] - wire[(i - 1) * 8 + 1]));
    }
    let zoneLit = 0, zoneSampled = 0;
    for (let i = 0; i < wire.length / 8; i++) {
        const x = wire[i * 8];
        if (x > -0.08 && x < 0.08) {
            zoneSampled++;
            const lit = wire[i * 8 + 6] <= 0.5 && (wire[i * 8 + 3] > 0 || wire[i * 8 + 4] > 0 || wire[i * 8 + 5] > 0);
            if (lit) zoneLit++;
        }
    }
    return { pts: wire.length / 8, maxStep, zoneLit, zoneSampled };
}

describe('full DAC chain: generator -> optimizer -> safety zone -> wire decimation', () => {
    it.each([
        ['circle', generateCircle, {}],
        ['sinewave', generateSinewave, {}],
        ['square', generateSquare, {}],
        ['star', generateStar, {}],
    ])('%s stays smooth and respects the zone on the wire', (name, gen, params) => {
        const s = stats(chain(gen, params));
        // A continuous trace: no single lit step jumps a visible gap.
        expect(s.maxStep, `${name} max lit step`).toBeLessThan(0.05);
        // And the safety zone is dark where the wire actually samples it.
        expect(s.zoneSampled).toBeGreaterThan(0);
        expect(s.zoneLit, `${name} lit samples inside the zone`).toBe(0);
        // Never over the wire budget by more than the forced transition points.
        expect(s.pts).toBeLessThanOrEqual(600);
    });
});

describe('applyOutputProcessing with scale: zones follow the scaled area', () => {
    // Area shrinks content to the centre half: u' = 0.25 + u*0.5.
    // Content centre (u=0.5) lands at field 0.5, inside field 0.45..0.55.
    const settings = {
        transformationEnabled: true,
        transformationMode: 'scale',
        outputArea: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
        safetyZones: [{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }],
    };
    function frameAt(u, v) {
        const x = u * 2 - 1, y = 1 - v * 2;
        return { points: new Float32Array([x, y, 0, 255, 255, 255, 0, 0]), isTypedArray: true };
    }
    function blanked(u, v) {
        const out = applyOutputProcessingWithDwell(frameAt(u, v), settings, 2);
        return out.points[6] > 0.5;
    }
    it('blanks content centre where the scaled zone sits', () => {
        expect(blanked(0.5, 0.5)).toBe(true); // field 0.5,0.5 inside 0.45..0.55
        expect(blanked(0.41, 0.5)).toBe(true); // field 0.455
        expect(blanked(0.59, 0.5)).toBe(true); // field 0.545
    });
    it('leaves content outside the scaled zone lit', () => {
        expect(blanked(0.1, 0.5)).toBe(false); // field 0.30
        expect(blanked(0.9, 0.5)).toBe(false); // field 0.70
        expect(blanked(0.5, 0.1)).toBe(false);
    });
    it('does not treat the zone as absolute field coords', () => {
        // Field 0.42,0.42 would be inside an absolute 0.4..0.6 zone but is
        // outside the scaled 0.45..0.55 zone. Content mapping to field 0.42
        // is u=(0.42-0.25)/0.5=0.34 -> must stay lit.
        expect(blanked(0.34, 0.34)).toBe(false);
    });
});