import { describe, it, expect } from 'vitest';
import { framesToIlda } from './ilda-writer.js';
import { parseIldaFile } from './ilda-parser.js';

describe('framesToIlda', () => {
    it('writes object point frames that round-trip through the parser', () => {
        const frames = [
            {
                points: [
                    { x: -0.5, y: 0.25, r: 255, g: 0, b: 0, blanking: false },
                    { x: 0.5, y: -0.25, r: 0, g: 128, b: 255, blanking: true },
                    { x: 0.75, y: 0.0, r: 0, g: 0, b: 0, blanking: false },
                ],
                frameName: 'TEST',
            },
        ];
        const buffer = framesToIlda(frames);
        const { frames: parsed } = parseIldaFile(buffer);
        expect(parsed).toHaveLength(1);
        const pts = parsed[0].points;
        expect(pts).toHaveLength(3);
        expect(pts[0].x).toBeCloseTo(-0.5, 4);
        expect(pts[0].y).toBeCloseTo(0.25, 4);
        expect(pts[0].r).toBe(255);
        expect(pts[0].b).toBe(0);
        expect(pts[2].r).toBe(0);
        expect(pts[2].g).toBe(0);
        expect(pts[2].b).toBe(0);
        // Blanked point registered as blanking, black color
        expect(pts[1].blanking).toBe(true);
        expect(pts[1].r).toBe(0);
        expect(pts[0].blanking).toBe(false);
        expect(pts[2].blanking).toBe(false);
    });

    it('round-trips flat Float32Array frames (the export-clip bug)', () => {
        // 8 floats per point: [x, y, z, r, g, b, blanking, lastPoint]
        const points = new Float32Array([
            -0.5, 0.25, 0, 255, 0, 0, 0, 0,
            0.5, -0.25, 0, 0, 128, 255, 1, 0,
            0.75, 0, 0, 0, 0, 0, 0, 1,
        ]);
        const buffer = framesToIlda([{ points, isTypedArray: true, frameName: 'FLAT' }]);
        const { frames: parsed } = parseIldaFile(buffer);
        expect(parsed).toHaveLength(1);
        const pts = parsed[0].points;
        expect(pts).toHaveLength(3);
        // Coordinates must NOT be zeroed (previously all were written as 0,0)
        expect(pts[0].x).toBeCloseTo(-0.5, 4);
        expect(pts[0].y).toBeCloseTo(0.25, 4);
        expect(pts[1].x).toBeCloseTo(0.5, 4);
        expect(pts[1].y).toBeCloseTo(-0.25, 4);
        expect(pts[2].x).toBeCloseTo(0.75, 4);
        expect(pts[1].blanking).toBe(true);
        expect(pts[1].r).toBe(0);
        expect(pts[0].r).toBe(255);
        expect(pts[1].g).toBe(0);
        expect(pts[1].b).toBe(0);
    });

    it('splits frames larger than the 16-bit point count into multiple ILDA frames', () => {
        const numPoints = 130000;
        const points = new Float32Array(numPoints * 8);
        for (let i = 0; i < numPoints; i++) {
            points[i * 8] = (i % 100) / 100; // x
            points[i * 8 + 3] = 255;
            points[i * 8 + 4] = 255;
            points[i * 8 + 5] = 255;
        }
        const buffer = framesToIlda([{ points, frameName: 'BIG' }]);
        const { frames: parsed } = parseIldaFile(buffer);
        expect(parsed.length).toBeGreaterThan(1);
        const totalParsed = parsed.reduce((sum, f) => sum + f.points.length, 0);
        expect(totalParsed).toBe(numPoints);
        parsed.forEach(f => expect(f.points.length).toBeLessThanOrEqual(65000));
    });

    it('handles empty frames without crashing', () => {
        const buffer = framesToIlda([{ points: [], frameName: 'EMPTY' }]);
        const { frames } = parseIldaFile(buffer);
        expect(frames).toHaveLength(0);
    });
});