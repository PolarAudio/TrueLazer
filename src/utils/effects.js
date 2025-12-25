import { effectDefinitions } from './effectDefinitions';

const withDefaults = (params, defaults) => ({ ...defaults, ...params });

/**
 * Optimized applyEffects that minimizes object creation and GC.
 * Assumes frame.points is a Float32Array where each point is 8 floats:
 * [x, y, z, r, g, b, blanking (0/1), lastPoint (0/1)]
 */
export function applyEffects(frame, effects, context = {}) {
  const { progress = 0, time = performance.now() } = context;

  if (!effects || effects.length === 0) return frame;

  // If points are still in object array format, convert them once (compatibility layer)
  let pointsData;
  if (Array.isArray(frame.points)) {
      pointsData = new Float32Array(frame.points.length * 8);
      for (let i = 0; i < frame.points.length; i++) {
          const p = frame.points[i];
          const offset = i * 8;
          pointsData[offset] = p.x;
          pointsData[offset + 1] = p.y;
          pointsData[offset + 2] = p.z || 0;
          pointsData[offset + 3] = p.r;
          pointsData[offset + 4] = p.g;
          pointsData[offset + 5] = p.b;
          pointsData[offset + 6] = p.blanking ? 1 : 0;
          pointsData[offset + 7] = p.lastPoint ? 1 : 0;
      }
  } else {
      // It's already a TypedArray, but we MUST copy it if we are going to modify it
      pointsData = new Float32Array(frame.points);
  }

  const numPoints = pointsData.length / 8;

  for (const effect of effects) {
    const definition = effectDefinitions.find(def => def.id === effect.id);
    if (!definition) continue;

    switch (effect.id) {
      case 'rotate':
        applyRotate(pointsData, numPoints, effect.params, progress, time);
        break;
      case 'scale':
        applyScale(pointsData, numPoints, effect.params);
        break;
      case 'translate':
        applyTranslate(pointsData, numPoints, effect.params);
        break;
      case 'color':
        applyColor(pointsData, numPoints, effect.params, time);
        break;
      case 'wave':
        applyWave(pointsData, numPoints, effect.params, time);
        break;
      case 'blanking':
        applyBlanking(pointsData, numPoints, effect.params);
        break;
      case 'strobe':
        applyStrobe(pointsData, numPoints, effect.params, time);
        break;
      case 'mirror':
        applyMirror(pointsData, numPoints, effect.params);
        break;
      default:
        break;
    }
  }

  return { ...frame, points: pointsData, isTypedArray: true };
}

function applyRotate(points, numPoints, params, progress, time) {
  const { angle, rotationSpeed } = withDefaults(params, effectDefinitions.find(def => def.id === 'rotate').defaultParams);
  
  // Use time for continuous rotation. 
  // rotationSpeed of 1 corresponds to approx 1 radian per second (~57 deg/sec)
  const continuousRotation = (time * 0.001) * rotationSpeed;
  const currentAngle = (angle * Math.PI / 180) + continuousRotation;
  
  const sin = Math.sin(currentAngle);
  const cos = Math.cos(currentAngle);

  for (let i = 0; i < numPoints; i++) {
    const offset = i * 8;
    const x = points[offset];
    const y = points[offset + 1];
    points[offset] = x * cos - y * sin;
    points[offset + 1] = x * sin + y * cos;
  }
}

function applyScale(points, numPoints, params) {
  const { scaleX, scaleY } = withDefaults(params, effectDefinitions.find(def => def.id === 'scale').defaultParams);
  for (let i = 0; i < numPoints; i++) {
    const offset = i * 8;
    points[offset] *= scaleX;
    points[offset + 1] *= scaleY;
  }
}

function applyTranslate(points, numPoints, params) {
  const { translateX, translateY } = withDefaults(params, effectDefinitions.find(def => def.id === 'translate').defaultParams);
  for (let i = 0; i < numPoints; i++) {
    const offset = i * 8;
    points[offset] += translateX;
    points[offset + 1] += translateY;
  }
}

function applyColor(points, numPoints, params, time) {
  const { mode, r, g, b, cycleSpeed, rainbowSpread, rainbowOffset, rainbowPalette } = withDefaults(params, effectDefinitions.find(def => def.id === 'color').defaultParams);
  const cycleTime = time * 0.001 * cycleSpeed;

  if (mode === 'rainbow') {
    const palette = rainbowPalette || 'rainbow';
    for (let i = 0; i < numPoints; i++) {
      const offset = i * 8;
      const normalizedPos = ((i / numPoints * rainbowSpread) + (cycleTime * 0.5) + (rainbowOffset / 360)) % 1.0;
      
      let cr, cg, cb;
      if (palette === 'rainbow') {
        [cr, cg, cb] = hslToRgb(normalizedPos, 1, 0.5);
      } else {
        [cr, cg, cb] = getPaletteColor(palette, normalizedPos);
      }
      
      points[offset + 3] = cr;
      points[offset + 4] = cg;
      points[offset + 5] = cb;
    }
  } else {
    // Solid mode with cycling
    if (cycleSpeed > 0) {
      const hue = (cycleTime * 50) % 360;
      const [cr, cg, cb] = hslToRgb(hue / 360, 1, 0.5);
      for (let i = 0; i < numPoints; i++) {
        const offset = i * 8;
        points[offset + 3] = cr;
        points[offset + 4] = cg;
        points[offset + 5] = cb;
      }
    } else {
      for (let i = 0; i < numPoints; i++) {
        const offset = i * 8;
        points[offset + 3] = r;
        points[offset + 4] = g;
        points[offset + 5] = b;
      }
    }
  }
}

/**
 * Gets a color from a named palette at a specific normalized position (0-1).
 */
function getPaletteColor(paletteName, pos) {
  const palettes = {
    'fire': [
      { r: 255, g: 0, b: 0 },    // Red
      { r: 255, g: 128, b: 0 },  // Orange
      { r: 255, g: 255, b: 0 },  // Yellow
      { r: 255, g: 0, b: 0 }     // Loop back to Red
    ],
    'ice': [
      { r: 0, g: 0, b: 255 },    // Blue
      { r: 0, g: 255, b: 255 },  // Cyan
      { r: 255, g: 255, b: 255 },// White
      { r: 0, g: 0, b: 255 }     // Loop back to Blue
    ],
    'cyber': [
      { r: 255, g: 0, b: 255 },  // Magenta
      { r: 0, g: 255, b: 255 },  // Cyan
      { r: 0, g: 0, b: 255 },    // Blue
      { r: 255, g: 0, b: 255 }   // Loop back to Magenta
    ]
  };

  const colors = palettes[paletteName] || palettes['fire'];
  const scaledPos = pos * (colors.length - 1);
  const index = Math.floor(scaledPos);
  const factor = scaledPos - index;

  const c1 = colors[index];
  const c2 = colors[index + 1] || colors[index];

  return [
    Math.round(c1.r + (c2.r - c1.r) * factor),
    Math.round(c1.g + (c2.g - c1.g) * factor),
    Math.round(c1.b + (c2.b - c1.b) * factor)
  ];
}

/**
 * Converts an HSL color value to RGB.
 * @param {number} h - The hue (0 to 1).
 * @param {number} s - The saturation (0 to 1).
 * @param {number} l - The lightness (0 to 1).
 * @returns {Array<number>} The RGB values [r, g, b] (0 to 255).
 */
function hslToRgb(h, s, l) {
  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function applyWave(points, numPoints, params, time) {
  const { amplitude, frequency, speed, direction } = withDefaults(params, effectDefinitions.find(def => def.id === 'wave').defaultParams);
  const timeShift = time * 0.001 * speed;

  for (let i = 0; i < numPoints; i++) {
    const offset = i * 8;
    if (direction === 'x') {
      points[offset + 1] += amplitude * Math.sin(points[offset] * frequency + timeShift);
    } else if (direction === 'y') {
      points[offset] += amplitude * Math.sin(points[offset + 1] * frequency + timeShift);
    }
  }
}

function applyBlanking(points, numPoints, params) {
  const { blankingInterval } = withDefaults(params, effectDefinitions.find(def => def.id === 'blanking').defaultParams);
  if (blankingInterval <= 0) return;

  for (let i = 0; i < numPoints; i++) {
    if ((i % (blankingInterval + 1)) === blankingInterval) {
        points[i * 8 + 6] = 1; // Set blanking bit
    }
  }
}

function applyStrobe(points, numPoints, params, time) {
  const { strobeSpeed, strobeAmount } = withDefaults(params, effectDefinitions.find(def => def.id === 'strobe').defaultParams);
  const cyclePosition = (time % strobeSpeed) / strobeSpeed;
  if (cyclePosition < strobeAmount) {
    for (let i = 0; i < numPoints; i++) {
        points[i * 8 + 6] = 1;
    }
  }
}

function applyMirror(points, numPoints, params) {
  const { mirrorX, mirrorY } = withDefaults(params, effectDefinitions.find(def => def.id === 'mirror').defaultParams);
  for (let i = 0; i < numPoints; i++) {
    const offset = i * 8;
    if (mirrorX) points[offset] = -points[offset];
    if (mirrorY) points[offset + 1] = -points[offset + 1];
  }
}