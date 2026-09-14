import { describe, it, expect } from 'vitest';
import {
  envelopeValue,
  easeCurve,
  pointsCenter,
  applyEffectToPoints,
  effectParamsDefaults,
  getEffectDef,
  EFFECTS,
  audioLevels
} from './shapeEffects';

const pt = (x, y, color = '#ffffff') => ({ x, y, color });

describe('envelope', () => {
  it('default single linear ramp from 0 to 1', () => {
    const env = { points: [{ t: 0, v: 0 }, { t: 1, v: 1 }], curve: 'linear', amount: 100 };
    expect(envelopeValue(env, 0)).toBe(0);
    expect(envelopeValue(env, 0.5)).toBeCloseTo(0.5, 5);
    expect(envelopeValue(env, 1)).toBe(1);
  });

  it('interpolates intermediate breakpoints', () => {
    const env = { points: [{ t: 0, v: 0 }, { t: 0.3, v: 1 }, { t: 1, v: 1 }], curve: 'linear', amount: 100 };
    expect(envelopeValue(env, 0.15)).toBeCloseTo(0.5, 5);
    expect(envelopeValue(env, 0.5)).toBe(1);
  });

  it('clamps to the first/last breakpoint outside the range', () => {
    const env = { points: [{ t: 0.2, v: 0.5 }, { t: 0.8, v: 1 }], curve: 'linear', amount: 100 };
    expect(envelopeValue(env, 0)).toBeCloseTo(0.5, 5);
    expect(envelopeValue(env, 0.9)).toBe(1);
  });

  it('shifts the loop start by phase', () => {
    const env = { points: [{ t: 0, v: 0 }, { t: 1, v: 1 }], curve: 'linear', amount: 100 };
    const phased = { ...env, phase: 0.25 };
    expect(envelopeValue(phased, 0.25)).toBe(0);
    expect(envelopeValue(phased, 0.5)).toBeCloseTo(0.25, 5);
    expect(envelopeValue(phased, 0)).toBeCloseTo(0.75, 5);
  });

  it('scales overall intensity by amount', () => {
    const env = { points: [{ t: 0, v: 0 }, { t: 1, v: 1 }], curve: 'linear', amount: 50 };
    expect(envelopeValue(env, 0.5)).toBeCloseTo(0.25, 5);
  });

  it('applies curve easing', () => {
    const pts = [{ t: 0, v: 0 }, { t: 1, v: 1 }];
    expect(envelopeValue({ points: pts, curve: 'easeIn', amount: 100 }, 0.5)).toBeCloseTo(0.25, 5);
    expect(envelopeValue({ points: pts, curve: 'easeOut', amount: 100 }, 0.5)).toBeCloseTo(0.75, 5);
    expect(envelopeValue({ points: pts, curve: 'easeInOut', amount: 100 }, 0.5)).toBeCloseTo(0.5, 5);
  });

  it('keeps evaluating legacy ADSR envelopes', () => {
    const env = { attack: 0.5, hold: 0.5, sustain: 0, release: 0, sustainLevel: 0.7, curve: 'linear', amount: 100 };
    expect(envelopeValue(env, 0.25)).toBeCloseTo(0.5, 2);
    expect(envelopeValue(env, 0.75)).toBe(1);
    expect(envelopeValue(env, 0.5)).toBe(1);
  });

  it('easeCurve eases correctly', () => {
    expect(easeCurve(0.5, 'easeIn')).toBeCloseTo(0.25, 5);
    expect(easeCurve(0.5, 'easeOut')).toBeCloseTo(0.75, 5);
    expect(easeCurve(0.5, 'easeInOut')).toBeCloseTo(0.5, 5);
  });
});

describe('applyEffectToPoints', () => {
  it('is a no-op when the envelope amplitude is zero', () => {
    const pts = [pt(0, 0), pt(10, 0)];
    const res = applyEffectToPoints(pts, { type: 'rotate', params: { angle: 90, cycles: 1 }, envelope: { ...{}, attack: 0, hold: 1, sustain: 0, release: 0, sustainLevel: 1, curve: 'linear', amount: 100 } }, 0);
    expect(res.points).toEqual([{ x: 0, y: 0, color: '#ffffff' }, { x: 10, y: 0, color: '#ffffff' }]);
  });

  it('rotates points about their center at full position', () => {
    const pts = [pt(0, 0), pt(10, 0)];
    const env = { attack: 0, hold: 1, sustain: 0, release: 0, sustainLevel: 1, curve: 'linear', amount: 100 };
    const res = applyEffectToPoints(pts, { type: 'rotate', params: { angle: 180, cycles: 1 }, envelope: env }, 1);
    const a = res.points[0];
    expect(a.x).toBeCloseTo(10, 3);
    expect(a.y).toBeCloseTo(0, 3);
  });

  it('oscillates on the X axis only', () => {
    const pts = [pt(5, 5), pt(15, 5)];
    const env = { attack: 0, hold: 1, sustain: 0, release: 0, sustainLevel: 1, curve: 'linear', amount: 100 };
    const res = applyEffectToPoints(pts, { type: 'oscillate', params: { axis: 0, amount: 20, cycles: 1 }, envelope: env }, 0.25);
    // sin(0.25 * 2pi) = 1 -> offset +20
    expect(res.points[0].x).toBeCloseTo(25, 3);
    expect(res.points[0].y).toBe(5);
  });

  it('orbits around the scene center', () => {
    const pts = [pt(500, 500)];
    const env = { attack: 0, hold: 1, sustain: 0, release: 0, sustainLevel: 1, curve: 'linear', amount: 100 };
    const res = applyEffectToPoints(pts, { type: 'orbit', params: { radius: 100, cycles: 1 }, envelope: env }, 0.5, { globalCenter: { x: 500, y: 500 } });
    expect(res.points[0].x).toBeCloseTo(400, 3); // cos(pi) = -1
    expect(res.points[0].y).toBeCloseTo(500, 3);
  });

  it('pulses away from the point cloud center', () => {
    const pts = [pt(0, 0), pt(100, 0)];
    const env = { attack: 0, hold: 1, sustain: 0, release: 0, sustainLevel: 1, curve: 'linear', amount: 100 };
    // sin(0.25*2pi)=1 -> f = 1 + 0.5*1*1*1 = 1.5 about center (50, 0)
    const res = applyEffectToPoints(pts, { type: 'pulse', params: { amount: 50, cycles: 1, global: 0 }, envelope: env }, 0.25);
    expect(res.points[0].x).toBeCloseTo(-25, 3);
    expect(res.points[1].x).toBeCloseTo(125, 3);
  });

  it('marks chase segments blanked based on on-ratio', () => {
    const pts = Array.from({ length: 8 }, (_, i) => pt(i * 10, 0));
    const env = { attack: 0, hold: 1, sustain: 0, release: 0, sustainLevel: 1, curve: 'linear', amount: 100 };
    const res = applyEffectToPoints(pts, { type: 'chase', params: { segments: 4, onRatio: 0.5 }, envelope: env }, 0);
    const blanks = res.points.filter(p => p._blank).length;
    expect(blanks).toBeGreaterThan(0);
    expect(blanks).toBeLessThan(res.points.length);
    expect(res.points[0]._blank).toBe(false); // first segment is in the on window at position 0
  });

  it('strobe blanks everything during the off phase', () => {
    const pts = [pt(0, 0), pt(10, 0), pt(20, 0)];
    const env = { attack: 0, hold: 1, sustain: 0, release: 0, sustainLevel: 1, curve: 'linear', amount: 100 };
    // flashes=1, position 0.75 -> phase .75 > duty .4 * 1 -> off
    const res = applyEffectToPoints(pts, { type: 'strobe', params: { flashes: 1, duty: 0.4 }, envelope: env }, 0.75);
    expect(res.points.every(p => p._blank)).toBe(true);
  });

  it('shifts hue during color cycle', () => {
    const pts = [pt(0, 0, '#ff0000')];
    const env = { attack: 0, hold: 1, sustain: 0, release: 0, sustainLevel: 1, curve: 'linear', amount: 100 };
    const res = applyEffectToPoints(pts, { type: 'colorcycle', params: { speed: 1, spread: 0 }, envelope: env }, 0.5);
    // hue rotated by 180 -> red becomes cyan
    expect(res.points[0].color).toBe('#00ffff');
  });

  it('audio band falls back to a synthetic drive', () => {
    const env = { attack: 0, hold: 1, sustain: 0, release: 0, sustainLevel: 1, curve: 'linear', amount: 100 };
    const p1 = applyEffectToPoints([pt(0, 0), pt(10, 0)], { type: 'audio', params: { band: 0, mode: 0, amount: 100 }, envelope: env }, 0.1);
    const p2 = applyEffectToPoints([pt(0, 0), pt(10, 0)], { type: 'audio', params: { band: 0, mode: 0, amount: 100 }, envelope: env }, 0.9);
    expect(p1.points).not.toEqual(p2.points);
  });
});

describe('registry', () => {
  it('exposes every effect with typed defaults', () => {
    for (const e of EFFECTS) {
      expect(getEffectDef(e.id)).toBe(e);
      const d = effectParamsDefaults(e.id);
      for (const p of e.params) {
        expect(d).toHaveProperty(p.id, p.def);
      }
    }
  });

  it('provides usable audio levels', () => {
    const l = audioLevels({}, 0.5);
    expect(typeof l.low).toBe('number');
    expect(l.low).toBeGreaterThanOrEqual(0);
    expect(l.low).toBeLessThanOrEqual(1);
  });

  it('computes the centroid of a point cloud', () => {
    expect(pointsCenter([pt(0, 0), pt(10, 10)])).toEqual({ x: 5, y: 5 });
  });
});