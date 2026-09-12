// --- ShapeBuilder Effects Engine ---
//
// Pure, testable modulation transforms applied to sampled shape points at a
// given playback position. Everything here is a function of (points, effect,
// position) plus optional audio levels, so the SAME code drives the live
// ShapeBuilder preview and the baked .ild export.

// ---------------------------------------------------------------------------
// Envelope (breakpoint curve over the clip position 0..1)
// ---------------------------------------------------------------------------

// Breakpoint model, edited visually: a polyline of {t, v} points. Default is a
// single linear ramp 0 -> 1. The whole curve loops across the clip.
export const DEFAULT_ENVELOPE = {
  points: [
    { t: 0, v: 0 },
    { t: 1, v: 1 }
  ],
  curve: 'linear', // 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
  phase: 0,        // shift the loop start (0..1)
  amount: 100      // overall intensity 0..100 %
};

export const ENVELOPE_CURVES = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

export function easeCurve(t, curve) {
  if (curve === 'easeIn') return t * t;
  if (curve === 'easeOut') return t * (2 - t);
  if (curve === 'easeInOut') return t * t * (3 - 2 * t);
  return t;
}

// Legacy ADSR-shaped envelopes (attack/hold/sustain/release/sustainLevel),
// kept so pre-breakpoint .clip files still evaluate correctly.
export function legacyEnvelopeValue(env, p) {
  const a = Math.max(0, env.attack ?? 0);
  const h = Math.max(0, env.hold ?? 0);
  const s = Math.max(0, env.sustain ?? 0);
  const r = Math.max(0, env.release ?? 0);
  const total = a + h + s + r;
  if (total > 0) p = (p * total) % total; // loop the envelope across the clip
  const sustainLevel = Math.max(0, Math.min(1, env.sustainLevel ?? 0.7));
  let v;
  if (p < a) v = easeCurve(a > 0 ? p / a : 1, env.curve || 'linear');
  else if (p < a + h) v = 1;
  else if (p < a + h + s) {
    const t = s > 0 ? (p - a - h) / s : 1;
    v = 1 - (1 - sustainLevel) * t;
  } else if (p < total) {
    const t = r > 0 ? (p - a - h - s) / r : 1;
    v = sustainLevel * (1 - easeCurve(t, env.curve || 'linear'));
  } else v = 0;
  return Math.max(0, Math.min(1, v)) * (env.amount ?? 100) / 100;
}

// Returns 0..1 intensity of the envelope at position p (0..1).
export function envelopeValue(env, p) {
  if (!env) env = DEFAULT_ENVELOPE;
  if (!Array.isArray(env.points)) return legacyEnvelopeValue(env, p);

  const pts = env.points.slice().sort((a, b) => a.t - b.t);
  if (pts.length === 0) return 0;
  const amount = Math.max(0, env.amount ?? 100) / 100;
  const phase = env.phase ?? 0;
  // Position 1 is the loop endpoint (kept exact); everything else wraps under
  // the phase offset so the curve loops seamlessly.
  const raw = p >= 1 ? 1 : ((p - phase) % 1 + 1) % 1;
  p = raw;

  const clampV = v => Math.max(0, Math.min(1, v));
  if (p <= pts[0].t) return clampV(pts[0].v) * amount;
  const last = pts[pts.length - 1];
  if (p >= last.t) return clampV(last.v) * amount;

  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    if (p >= A.t && p <= B.t) {
      const span = Math.max(0.0001, B.t - A.t);
      const t = easeCurve((p - A.t) / span, env.curve || 'linear');
      return clampV(A.v + (B.v - A.v) * t) * amount;
    }
  }
  return clampV(pts[0].v) * amount;
}

// ---------------------------------------------------------------------------
// Helper geometry / color math (input points must be plain {x,y,color})
// ---------------------------------------------------------------------------

export function pointsCenter(pts) {
  if (!pts || pts.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  return { x: sx / pts.length, y: sy / pts.length };
}

function rotateAbout(pts, center, angleRad) {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  return pts.map(p => {
    const dx = p.x - center.x, dy = p.y - center.y;
    return { ...p, x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
  });
}

function scaleAbout(pts, center, fx, fy = fx) {
  return pts.map(p => {
    const dx = p.x - center.x, dy = p.y - center.y;
    return { ...p, x: center.x + dx * fx, y: center.y + dy * fy };
  });
}

function hexToRgb(hex) {
  let c = (hex || '#ffffff').replace('#', '');
  if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
  const n = parseInt(c, 16);
  if (isNaN(n)) return { r: 255, g: 255, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  const to = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

// Deterministic pseudo-audio fallback so baked exports and headless previews
// animate sensibly even when no live FFT is available.
export function syntheticAudioLevel(position) {
  const low = 0.55 + 0.45 * Math.sin(position * Math.PI * 2 * 2 + 1);
  const mid = 0.5 + 0.5 * Math.sin(position * Math.PI * 2 * 3);
  const high = 0.45 + 0.55 * Math.sin(position * Math.PI * 2 * 5 + 0.5);
  return { low, mid, high, volume: (low + mid + high) / 3 };
}

export function audioLevels(ctx, position) {
  if (ctx && ctx.audio) return ctx.audio;
  return syntheticAudioLevel(position);
}

// ---------------------------------------------------------------------------
// Effect registry (metadata drives the generic param UI)
// ---------------------------------------------------------------------------

export const EFFECT_GROUPS = ['Movements', 'Beam', 'Scale', 'Color', 'Audio'];

export const EFFECTS = [
  { id: 'rotate',     label: 'Rotate',       group: 'Movements', params: [
    { id: 'angle',     label: 'Angle (deg)', min: -360, max: 360, step: 1, def: 90 },
    { id: 'cycles',    label: 'Cycles',      min: 0.1, max: 8,   step: 0.1, def: 1 }
  ]},
  { id: 'oscillate',  label: 'Oscillate',    group: 'Movements', params: [
    { id: 'axis',      label: 'Axis',        min: 0, max: 2, step: 1, def: 0, options: ['X', 'Y', 'Both'] },
    { id: 'amount',    label: 'Amount (px)', min: 0, max: 200, step: 1, def: 40 },
    { id: 'cycles',    label: 'Cycles',      min: 0.5, max: 12, step: 0.1, def: 2 }
  ]},
  { id: 'orbit',      label: 'Orbit',        group: 'Movements', params: [
    { id: 'radius',    label: 'Radius (px)', min: 0, max: 300, step: 1, def: 80 },
    { id: 'cycles',    label: 'Cycles',      min: 0.25, max: 8, step: 0.25, def: 1 }
  ]},
  { id: 'bounce',     label: 'Bounce',       group: 'Movements', params: [
    { id: 'height',    label: 'Height (px)', min: 0, max: 200, step: 1, def: 60 },
    { id: 'cycles',    label: 'Cycles',      min: 0.5, max: 12, step: 0.1, def: 1 },
    { id: 'squash',    label: 'Squash',      min: 0, max: 0.4, step: 0.01, def: 0.15 }
  ]},
  { id: 'pulse',      label: 'Pulse / Zoom', group: 'Scale', params: [
    { id: 'amount',    label: 'Amount (%)',  min: 0, max: 100, step: 1, def: 30 },
    { id: 'cycles',    label: 'Cycles',      min: 0.5, max: 12, step: 0.1, def: 2 },
    { id: 'global',    label: 'Pivot',       min: 0, max: 1, step: 1, def: 0, options: ['Shape center', 'Scene center'] }
  ]},
  { id: 'chase',      label: 'Chase',        group: 'Beam', params: [
    { id: 'segments',  label: 'Segments',    min: 2, max: 16, step: 1, def: 4 },
    { id: 'onRatio',   label: 'On ratio',    min: 0.1, max: 1, step: 0.05, def: 0.5 }
  ]},
  { id: 'strobe',     label: 'Strobe',       group: 'Beam', params: [
    { id: 'flashes',   label: 'Flashes',     min: 1, max: 40, step: 1, def: 10 },
    { id: 'duty',      label: 'Duty',        min: 0.05, max: 1, step: 0.05, def: 0.4 }
  ]},
  { id: 'colorcycle', label: 'Color Cycle',  group: 'Color', params: [
    { id: 'speed',     label: 'Speed (rev)', min: 0, max: 6, step: 0.1, def: 1 },
    { id: 'spread',    label: 'Rainbow spread', min: 0, max: 1, step: 0.05, def: 0 }
  ]},
  { id: 'audio',      label: 'Audio Drive',  group: 'Audio', params: [
    { id: 'band',      label: 'Band',        min: 0, max: 3, step: 1, def: 0, options: ['Bass', 'Mid', 'High', 'Volume'] },
    { id: 'mode',      label: 'Mode',        min: 0, max: 2, step: 1, def: 0, options: ['Pulse', 'Shake', 'Bounce'] },
    { id: 'amount',    label: 'Amount (%)',  min: 0, max: 200, step: 1, def: 100 }
  ]}
];

export function getEffectDef(id) {
  return EFFECTS.find(e => e.id === id) || null;
}

export function effectParamsDefaults(type) {
  const def = getEffectDef(type);
  if (!def) return {};
  const out = {};
  def.params.forEach(p => { out[p.id] = p.def; });
  return out;
}

// ---------------------------------------------------------------------------
// Point modulation: (points, effect, position) -> transformed points
// ---------------------------------------------------------------------------

export function applyEffectToPoints(points, effect, position, ctx = {}) {
  if (!effect || !effect.type || !points || points.length === 0) {
    return { points: points || [] };
  }
  const def = getEffectDef(effect.type);
  if (!def) return { points };
  const params = { ...effectParamsDefaults(effect.type), ...(effect.params || {}) };
  // Per-parameter playback envelopes: a parameter that owns an envelope
  // (effect.envelopes[paramId]) is scaled by that curve across the clip;
  // a parameter without an envelope acts at its constant slider value.
  // Legacy clips store a single global `envelope` -> keep scaling everything.
  const envs = effect.envelopes || {};
  const legacyEnv = Object.keys(envs).length === 0 ? effect.envelope : null;
  const globalFactor = legacyEnv ? envelopeValue(legacyEnv, position) : 1;
  if (legacyEnv && globalFactor <= 0) return { points };
  const envOf = (paramId) => {
    if (legacyEnv) return Math.max(0, Math.min(1, globalFactor));
    const e = envs[paramId];
    return e ? Math.max(0, Math.min(1, envelopeValue(e, position))) : 1;
  };

  const center = ctx.center || pointsCenter(points);
  const globalCenter = ctx.globalCenter || { x: 500, y: 500 };
  const level = audioLevels(ctx, position);
  let out = points.map(pt => ({ ...pt }));

  switch (effect.type) {
    case 'rotate': {
      const totalAngle = (params.angle || 0) * (params.cycles || 1) * envOf('angle');
      out = rotateAbout(out, center, (totalAngle / 180 * Math.PI) * position);
      break;
    }
    case 'oscillate': {
      const phase = position * Math.PI * 2 * (params.cycles || 1);
      const off = Math.sin(phase) * (params.amount || 0) * envOf('amount');
      const axis = params.axis || 0;
      out = out.map(pt => ({ ...pt, x: (axis !== 1) ? pt.x + off : pt.x, y: (axis !== 0) ? pt.y + off : pt.y }));
      break;
    }
    case 'orbit': {
      const phase = position * Math.PI * 2 * (params.cycles || 1);
      const rad = (params.radius || 0) * envOf('radius');
      const dx = Math.cos(phase) * rad, dy = Math.sin(phase) * rad;
      out = out.map(pt => ({ ...pt, x: pt.x + dx, y: pt.y + dy }));
      break;
    }
    case 'bounce': {
      const s = Math.sin(Math.PI * position * (params.cycles || 1));
      const yOff = Math.abs(s) * (params.height || 0) * envOf('height');
      const squash = params.squash || 0;
      const fy = 1 + squash * (Math.abs(s) - 1);
      out = scaleAbout(out, { x: center.x, y: center.y - yOff }, 1, fy);
      out = out.map(pt => ({ ...pt, y: pt.y - yOff }));
      break;
    }
    case 'pulse': {
      const phase = Math.sin(position * Math.PI * 2 * (params.cycles || 1));
      const f = 1 + (params.amount || 0) / 100 * phase * envOf('amount');
      const pivot = params.global ? globalCenter : center;
      out = scaleAbout(out, pivot, f);
      break;
    }
    case 'colorcycle': {
      const hueShift = (params.speed || 0) * 360 * position * envOf('speed');
      const spreadFx = (params.spread || 0) * envOf('spread');
      const n = Math.max(1, out.length);
      out = out.map((pt, i) => {
        const rgb = hexToRgb(pt.color);
        const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        return { ...pt, color: hsvToHex(hsv.h + hueShift + (spreadFx ? (i / n) * 360 * spreadFx : 0), hsv.s, hsv.v) };
      });
      break;
    }
    case 'chase': {
      const segments = Math.max(1, Math.round(params.segments || 4));
      const onRatio = Math.max(0, Math.min(1, (params.onRatio ?? 0.5) * envOf('onRatio')));
      const onCount = Math.max(1, Math.round(onRatio * segments));
      const windowStart = Math.floor(position * segments) % segments;
      out = out.map((pt, i) => {
        const seg = Math.min(segments - 1, Math.floor((i / Math.max(1, out.length - 1)) * segments));
        const rel = ((seg - windowStart) % segments + segments) % segments;
        return { ...pt, _blank: rel >= onCount };
      });
      break;
    }
    case 'strobe': {
      const flashes = Math.max(1, params.flashes || 10);
      const duty = Math.max(0, Math.min(1, (params.duty ?? 0.4) * envOf('duty')));
      const phase = (position * flashes) % 1;
      const on = phase < duty;
      out = out.map(pt => ({ ...pt, _blank: !on }));
      break;
    }
    case 'audio': {
      const band = params.band || 0;
      const bandKey = band === 0 ? 'low' : band === 1 ? 'mid' : band === 2 ? 'high' : 'volume';
      const lvl = (level[bandKey] || 0);
      const modal = (lvl - 0.5) * 2;
      const amount = (params.amount || 0) / 100 * envOf('amount');
      const mode = params.mode || 0;
      if (mode === 1) { // shake
        out = out.map((pt, i) => ({ ...pt, x: pt.x + modal * amount * Math.sin(i * 12.9898) * 40 }));
      } else if (mode === 2) { // bounce
        const s = Math.abs(Math.sin(position * Math.PI * 2 * Math.max(1, level[bandKey] * 4)));
        const yOff = lvl * amount * s * 120;
        out = out.map(pt => ({ ...pt, y: pt.y - yOff }));
      } else { // pulse (scale)
        const f = 1 + modal * amount * 0.5;
        out = scaleAbout(out, center, f);
      }
      break;
    }
    default:
      break;
  }

  return { points: out };
}