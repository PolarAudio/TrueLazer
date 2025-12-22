import { effectDefinitions } from './effectDefinitions';

let globalRotationAngle = 0;
let lastAnimationFrameTime = 0;
const rotationUpdateInterval = 16; // Approximately 60 FPS

const withDefaults = (params, defaults) => ({ ...defaults, ...params });

/**
 * Optimized applyEffects that minimizes object creation and GC.
 * Assumes frame.points is a Float32Array where each point is 8 floats:
 * [x, y, z, r, g, b, blanking (0/1), lastPoint (0/1)]
 */
export function applyEffects(frame, effects) {
  const currentTime = performance.now();
  if (currentTime - lastAnimationFrameTime > rotationUpdateInterval) {
    globalRotationAngle = (globalRotationAngle + 0.01) % (2 * Math.PI);
    lastAnimationFrameTime = currentTime;
  }

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
        applyRotate(pointsData, numPoints, effect.params, globalRotationAngle);
        break;
      case 'scale':
        applyScale(pointsData, numPoints, effect.params);
        break;
      case 'translate':
        applyTranslate(pointsData, numPoints, effect.params);
        break;
      case 'color':
        applyColor(pointsData, numPoints, effect.params);
        break;
      case 'wave':
        applyWave(pointsData, numPoints, effect.params);
        break;
      case 'blanking':
        applyBlanking(pointsData, numPoints, effect.params);
        break;
      case 'strobe':
        applyStrobe(pointsData, numPoints, effect.params);
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

function applyRotate(points, numPoints, params, globalRotationAngle) {
  const { angle, rotationSpeed } = withDefaults(params, effectDefinitions.find(def => def.id === 'rotate').defaultParams);
  const currentAngle = (angle * Math.PI / 180) + (globalRotationAngle * rotationSpeed);
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

function applyColor(points, numPoints, params) {
  const { r, g, b } = withDefaults(params, effectDefinitions.find(def => def.id === 'color').defaultParams);
  for (let i = 0; i < numPoints; i++) {
    const offset = i * 8;
    points[offset + 3] = r;
    points[offset + 4] = g;
    points[offset + 5] = b;
  }
}

function applyWave(points, numPoints, params) {
  const { amplitude, frequency, speed, direction } = withDefaults(params, effectDefinitions.find(def => def.id === 'wave').defaultParams);
  const timeShift = Date.now() * 0.001 * speed;

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

function applyStrobe(points, numPoints, params) {
  const { strobeSpeed, strobeAmount } = withDefaults(params, effectDefinitions.find(def => def.id === 'strobe').defaultParams);
  const now = Date.now();
  const cyclePosition = (now % strobeSpeed) / strobeSpeed;
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