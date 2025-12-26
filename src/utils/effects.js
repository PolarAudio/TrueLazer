import { effectDefinitions } from './effectDefinitions';

const withDefaults = (params, defaults) => ({ ...defaults, ...params });

/**
 * Optimized applyEffects that minimizes object creation and GC.
 * Assumes frame.points is a Float32Array where each point is 8 floats:
 * [x, y, z, r, g, b, blanking (0/1), lastPoint (0/1)]
 */
export function applyEffects(frame, effects, context = {}) {
  const { progress = 0, time = performance.now(), effectStates } = context;

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

  let currentPoints = pointsData;
  const numPoints = () => currentPoints.length / 8;

  for (const effect of effects) {
    const definition = effectDefinitions.find(def => def.id === effect.id);
    if (!definition) continue;

    switch (effect.id) {
      case 'rotate':
        applyRotate(currentPoints, numPoints(), effect.params, progress, time);
        break;
      case 'scale':
        applyScale(currentPoints, numPoints(), effect.params);
        break;
      case 'translate':
        applyTranslate(currentPoints, numPoints(), effect.params);
        break;
      case 'color':
        applyColor(currentPoints, numPoints(), effect.params, time);
        break;
      case 'wave':
        applyWave(currentPoints, numPoints(), effect.params, time);
        break;
      case 'blanking':
        applyBlanking(currentPoints, numPoints(), effect.params);
        break;
      case 'strobe':
        applyStrobe(currentPoints, numPoints(), effect.params, time);
        break;
      case 'mirror':
        applyMirror(currentPoints, numPoints(), effect.params);
        break;
      case 'warp':
        applyWarp(currentPoints, numPoints(), effect.params, time);
        break;
      case 'distortion':
        applyDistortion(currentPoints, numPoints(), effect.params, time);
        break;
      case 'move':
        applyMove(currentPoints, numPoints(), effect.params, time);
        break;
      case 'delay':
        // Delay can change point count, so we update currentPoints
        if (effectStates && effect.instanceId) {
            currentPoints = applyDelay(currentPoints, numPoints(), effect.params, effectStates, effect.instanceId);
        }
        break;
      default:
        break;
    }
  }

  return { ...frame, points: currentPoints, isTypedArray: true };
}

function applyRotate(points, numPoints, params, progress, time) {
  const { angle, speed, direction } = withDefaults(params, effectDefinitions.find(def => def.id === 'rotate').defaultParams);
  
  // speed 0-10. Direction CW = 1, CCW = -1
  const dirMult = direction === 'CCW' ? -1 : 1;
  const continuousRotation = (time * 0.001) * speed * dirMult;
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
  const { mode } = withDefaults(params, effectDefinitions.find(def => def.id === 'mirror').defaultParams);
  if (mode === 'none') return;

  for (let i = 0; i < numPoints; i++) {
    const offset = i * 8;
    const x = points[offset];
    const y = points[offset + 1];
    
    // Fold logic:
    // x+: Fold Left onto Right (Keep +). x < 0 ? x = -x : x
    if (mode === 'x+') points[offset] = Math.abs(x);
    else if (mode === 'x-') points[offset] = -Math.abs(x);
    else if (mode === 'y+') points[offset + 1] = Math.abs(y);
    else if (mode === 'y-') points[offset + 1] = -Math.abs(y);
  }
}

function applyWarp(points, numPoints, params, time) {
    const { amount, chaos, speed } = withDefaults(params, effectDefinitions.find(def => def.id === 'warp').defaultParams);
    const t = time * 0.001 * speed;
    for(let i=0; i<numPoints; i++) {
        const off = i*8;
        const x = points[off];
        const y = points[off+1];
        
        const symY = Math.abs(y);
        points[off] += Math.sin(symY * 10 * (1+chaos) + t) * amount * Math.cos(t * chaos);
        points[off+1] += Math.cos(Math.abs(x) * 10 * (1+chaos) + t) * amount * Math.sin(t * chaos);
    }
}

function applyDistortion(points, numPoints, params, time) {
   const { amount, scale, speed } = withDefaults(params, effectDefinitions.find(def => def.id === 'distortion').defaultParams);
   const t = time * 0.001 * speed;
   for(let i=0; i<numPoints; i++) {
       const off = i*8;
       const noiseX = Math.sin(points[off] * scale + t) * Math.cos(points[off+1] * scale - t);
       const noiseY = Math.cos(points[off] * scale - t) * Math.sin(points[off+1] * scale + t);
       points[off] += noiseX * amount;
       points[off+1] += noiseY * amount;
   }
}

function applyMove(points, numPoints, params, time) {
    const { speedX, speedY } = withDefaults(params, effectDefinitions.find(def => def.id === 'move').defaultParams);
    const t = time * 0.001;
    
    // Bouncing coordinate space calculation
    const offsetX = t * speedX;
    const offsetY = t * speedY;
    
    const cycle = 4;
    
    for(let i=0; i<numPoints; i++) {
        const off = i*8;
        let x = points[off] + offsetX;
        let y = points[off+1] + offsetY;
        
        let valX = (x + 1) % cycle;
        if (valX < 0) valX += cycle;
        if (valX > 2) valX = 4 - valX;
        x = valX - 1;
        
        let valY = (y + 1) % cycle;
        if (valY < 0) valY += cycle;
        if (valY > 2) valY = 4 - valY;
        y = valY - 1;
        
        points[off] = x;
        points[off+1] = y;
    }
}

function applyDelay(points, numPoints, params, effectStates, instanceId) {
    const { delayAmount, decay, mode, target, direction } = withDefaults(params, effectDefinitions.find(def => def.id === 'delay').defaultParams);
    
    if (!effectStates.has(instanceId)) {
        effectStates.set(instanceId, []);
    }
    
    const history = effectStates.get(instanceId);
    
    // 1. Save current frame snapshot
    // We must clone the points because 'points' is reused/mutated in place by previous effects
    const currentSnapshot = new Float32Array(points);
    history.unshift(currentSnapshot);
    
    // Limit history size. Let's keep up to 4 echoes -> 4 * delayAmount
    const maxHistory = delayAmount * 4 + 1;
    if (history.length > maxHistory) {
        history.length = maxHistory;
    }
    
    // 2. Create Echoes
    // We will merge current points with echoes.
    // Calculate total size
    // Note: We assume all history frames have same size. If not (e.g. generator changed), we might have issues.
    // For safety, only use frames with same length.
    
    const echoes = [];
    for(let i=1; i<=4; i++) {
        const index = i * delayAmount;
        if (index < history.length) {
            const echoPoints = history[index];
            if (echoPoints.length === points.length) {
                echoes.push({ points: echoPoints, factor: Math.pow(decay, i) });
            }
        }
    }
    
    if (echoes.length === 0) return points; // No history yet
    
    // Create new buffer
    const totalPoints = numPoints + echoes.reduce((sum, e) => sum + e.points.length / 8, 0);
    const newBuffer = new Float32Array(totalPoints * 8);
    
    // Copy current points
    newBuffer.set(points, 0);
    let offset = points.length;
    
    // Copy echoes
    // target: 'intensity' (dim), 'color' (?), 'effect' (?)
    // For now, implement Intensity Decay for all.
    
    for (const echo of echoes) {
        const ePoints = echo.points;
        const eNum = ePoints.length / 8;
        const factor = echo.factor;
        
        // Copy and Modify
        for(let i=0; i<eNum; i++) {
            const srcOff = i*8;
            const dstOff = offset + i*8;
            
            // Copy XYZ
            newBuffer[dstOff] = ePoints[srcOff];
            newBuffer[dstOff+1] = ePoints[srcOff+1];
            newBuffer[dstOff+2] = ePoints[srcOff+2];
            
            // Color/Intensity
            // If target is Intensity: R,G,B are multiplied by factor
            newBuffer[dstOff+3] = ePoints[srcOff+3] * factor;
            newBuffer[dstOff+4] = ePoints[srcOff+4] * factor;
            newBuffer[dstOff+5] = ePoints[srcOff+5] * factor;
            
            newBuffer[dstOff+6] = ePoints[srcOff+6]; // Blanking
            newBuffer[dstOff+7] = ePoints[srcOff+7]; // LastPoint
        }
        offset += ePoints.length;
    }
    
    return newBuffer;
}