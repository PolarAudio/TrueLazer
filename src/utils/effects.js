import { effectDefinitions } from './effectDefinitions';

let globalRotationAngle = 0;
let lastAnimationFrameTime = 0;
const rotationUpdateInterval = 16; // Approximately 60 FPS

const withDefaults = (params, defaults) => ({ ...defaults, ...params });

export function applyEffects(frame, effects) {
  let modifiedFrame = { ...frame };
  const currentTime = performance.now();

  if (currentTime - lastAnimationFrameTime > rotationUpdateInterval) {
    globalRotationAngle = (globalRotationAngle + 0.01) % (2 * Math.PI); // Update global rotation slowly
    lastAnimationFrameTime = currentTime;
  }

  for (const effect of effects) {
    const definition = effectDefinitions.find(def => def.id === effect.id);
    if (!definition) continue;

    switch (effect.id) {
      case 'rotate':
        modifiedFrame = applyRotate(modifiedFrame, effect.params, globalRotationAngle);
        break;
      case 'scale':
        modifiedFrame = applyScale(modifiedFrame, effect.params);
        break;
      case 'translate':
        modifiedFrame = applyTranslate(modifiedFrame, effect.params);
        break;
      case 'color':
        modifiedFrame = applyColor(modifiedFrame, effect.params);
        break;
      case 'wave':
        modifiedFrame = applyWave(modifiedFrame, effect.params);
        break;
      case 'blanking':
        modifiedFrame = applyBlanking(modifiedFrame, effect.params);
        break;
      case 'strobe':
        modifiedFrame = applyStrobe(modifiedFrame, effect.params);
        break;
      case 'mirror':
        modifiedFrame = applyMirror(modifiedFrame, effect.params);
        break;
      default:
        break;
    }
  }

  return modifiedFrame;
}

function applyRotate(frame, params, globalRotationAngle) {
  const { angle, rotationSpeed } = withDefaults(params, effectDefinitions.find(def => def.id === 'rotate').defaultParams);
  
  // Combine static angle with dynamic rotationSpeed based on global animation frame
  const currentAngle = (angle * Math.PI / 180) + (globalRotationAngle * rotationSpeed);
  const sin = Math.sin(currentAngle);
  const cos = Math.cos(currentAngle);

  const newPoints = frame.points.map(point => {
    const x = point.x * cos - point.y * sin;
    const y = point.x * sin + point.y * cos;
    return { ...point, x, y };
  });

  return { ...frame, points: newPoints };
}

function applyScale(frame, params) {
  const { scaleX, scaleY } = withDefaults(params, effectDefinitions.find(def => def.id === 'scale').defaultParams);

  const newPoints = frame.points.map(point => {
    const x = point.x * scaleX;
    const y = point.y * scaleY;
    return { ...point, x, y };
  });

  return { ...frame, points: newPoints };
}

function applyTranslate(frame, params) {
  const { translateX, translateY } = withDefaults(params, effectDefinitions.find(def => def.id === 'translate').defaultParams);

  const newPoints = frame.points.map(point => {
    const x = point.x + translateX;
    const y = point.y + translateY;
    return { ...point, x, y };
  });

  return { ...frame, points: newPoints };
}

function applyColor(frame, params) {
  const { r, g, b } = withDefaults(params, effectDefinitions.find(def => def.id === 'color').defaultParams);

  const newPoints = frame.points.map(point => {
    return { ...point, r, g, b };
  });

  return { ...frame, points: newPoints };
}

function applyWave(frame, params) {
  const { amplitude, frequency, speed, direction } = withDefaults(params, effectDefinitions.find(def => def.id === 'wave').defaultParams);

  const newPoints = frame.points.map(point => {
    let x = point.x;
    let y = point.y;

    if (direction === 'x') {
      y += amplitude * Math.sin(point.x * frequency + Date.now() * 0.001 * speed);
    } else if (direction === 'y') {
      x += amplitude * Math.sin(point.y * frequency + Date.now() * 0.001 * speed);
    }

    return { ...point, x, y };
  });

  return { ...frame, points: newPoints };
}

function applyBlanking(frame, params) {
  const { blankingInterval } = withDefaults(params, effectDefinitions.find(def => def.id === 'blanking').defaultParams);

  if (blankingInterval <= 0) return frame;

  const newPoints = frame.points.map((point, index) => {
    const blank = (index % (blankingInterval + 1)) === blankingInterval;
    return { ...point, blanking: point.blanking || blank };
  });

  return { ...frame, points: newPoints };
}

function applyStrobe(frame, params) {
  const { strobeSpeed, strobeAmount } = withDefaults(params, effectDefinitions.find(def => def.id === 'strobe').defaultParams);

  const now = Date.now();
  const cycleTime = strobeSpeed; // milliseconds
  const cyclePosition = (now % cycleTime) / cycleTime; // 0 to 1

  // If cyclePosition is within the strobeAmount, then blank
  const blank = cyclePosition < strobeAmount;

  const newPoints = frame.points.map(point => {
    return { ...point, blanking: point.blanking || blank };
  });

  return { ...frame, points: newPoints };
}

function applyMirror(frame, params) {
  const { mirrorX, mirrorY } = withDefaults(params, effectDefinitions.find(def => def.id === 'mirror').defaultParams);

  if (!mirrorX && !mirrorY) return frame;

  const newPoints = frame.points.map(point => {
    const x = mirrorX ? -point.x : point.x;
    const y = mirrorY ? -point.y : point.y;
    return { ...point, x, y };
  });

  return { ...frame, points: newPoints };
}
