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
      case 'chase':
        applyChase(currentPoints, numPoints(), effect.params, time);
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
    // x+: Fold Left onto Right (Keep +). if x < 0, x = -x (abs)
    // x-: Fold Right onto Left (Keep -). if x > 0, x = -x (-abs)
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
    const defaults = effectDefinitions.find(def => def.id === 'delay').defaultParams;
    const { 
        delayAmount, decay, 
        delayI, delayC, delayE, 
        delayMode, delayDirection 
    } = withDefaults(params, defaults);
    
    if (!effectStates.has(instanceId)) {
        effectStates.set(instanceId, []);
    }
    
    const history = effectStates.get(instanceId);
    
    // 1. Save current frame snapshot
    // Ensure we clone the data
    const currentSnapshot = new Float32Array(points);
    history.unshift(currentSnapshot);
    
    // Limit history size.
    const maxHistory = delayAmount * 4 + 1;
    if (history.length > maxHistory) {
        history.length = maxHistory;
    }
    
    // 2. Create Echoes
    const echoes = [];
    for(let i=1; i<=4; i++) {
        const index = i * delayAmount;
        if (index < history.length) {
            const echoPoints = history[index];
            if (echoPoints.length === points.length) {
                echoes.push({ points: echoPoints, factor: Math.pow(decay, i), index: i });
            }
        }
    }
    
    if (echoes.length === 0) return points;
    
    // Create new buffer
    const totalPoints = numPoints + echoes.reduce((sum, e) => sum + e.points.length / 8, 0);
    const newBuffer = new Float32Array(totalPoints * 8);
    
    // Copy current points first (on top or bottom? usually top, so echoes go first)
    // Actually, usually echoes are "behind".
    // Let's write Echoes first, then Current frame.
    
    let offset = 0;

    for (const echo of echoes.reverse()) { // Draw oldest echo first (furthest back)
        const ePoints = echo.points;
        const eNum = ePoints.length / 8;
        const factor = echo.factor;
        const echoIdx = echo.index;
        
        // Calculate Spatial Offset based on direction/mode
        let offX = 0, offY = 0;
        let scaleX = 1, scaleY = 1;
        
        if (delayDirection === 'left_to_right') offX = -0.1 * echoIdx; // Trail behind to left? Or push echo right?
        // If "Delay Left to Right", maybe implies the *delayed* copy appears to the Right.
        else if (delayDirection === 'right_to_left') offX = 0.1 * echoIdx;
        else if (delayDirection === 'center_to_out') {
             scaleX = scaleY = 1 + (0.1 * echoIdx);
        } else if (delayDirection === 'out_to_center') {
             scaleX = scaleY = 1 - (0.1 * echoIdx);
        }

        // Copy and Modify
        for(let i=0; i<eNum; i++) {
            const srcOff = i*8;
            const dstOff = offset + i*8;
            
            // Source Data (Past)
            const srcX = ePoints[srcOff];
            const srcY = ePoints[srcOff+1];
            const srcZ = ePoints[srcOff+2];
            const srcR = ePoints[srcOff+3];
            const srcG = ePoints[srcOff+4];
            const srcB = ePoints[srcOff+5];
            const srcBlk = ePoints[srcOff+6];

            // Current Data (Present equivalent point)
            // Note: If point count changed, this mapping is invalid. We assume count matches.
            const currX = points[srcOff];
            const currY = points[srcOff+1];
            const currR = points[srcOff+3];
            const currG = points[srcOff+4];
            const currB = points[srcOff+5];
            const currBlk = points[srcOff+6];

            // Mix based on flags (I, C, E)
            // E = Effect/Position. If true, use Past Position (transformed). If false, use Current Position.
            // C = Color. If true, use Past Color. If false, use Current Color.
            // I = Intensity. If true, use Past Blanking. If false, use Current Blanking.
            // Note: We always apply decay to Color/Intensity of the echo to make it fade.

            let x = delayE ? srcX : currX;
            let y = delayE ? srcY : currY;
            
            // Apply Spatial Transform to Echo Position
            x = x * scaleX + offX;
            y = y * scaleY + offY;

            newBuffer[dstOff] = x;
            newBuffer[dstOff+1] = y;
            newBuffer[dstOff+2] = srcZ; // Z usually follows X/Y logic

            // Color
            const r = delayC ? srcR : currR;
            const g = delayC ? srcG : currG;
            const b = delayC ? srcB : currB;

            newBuffer[dstOff+3] = r * factor;
            newBuffer[dstOff+4] = g * factor;
            newBuffer[dstOff+5] = b * factor;
            
            // Intensity / Blanking
            // If delayI is true, we respect the blanking of the past frame.
            // If delayI is false, we use the blanking of the current frame?
            // If the echo uses current blanking but shifted position, it might look weird.
            // Usually Echo implies "Past Image".
            // If I uncheck "I", maybe I want the echo to be fully bright (no decay)?
            // Or maybe I want it to be visible even if originally blanked?
            // Let's stick to: delayI selects SOURCE of blanking bit.
            
            const blk = delayI ? srcBlk : currBlk;
            newBuffer[dstOff+6] = blk; 
            newBuffer[dstOff+7] = ePoints[srcOff+7]; // LastPoint
        }
        offset += ePoints.length;
    }

    // Finally copy current frame
    newBuffer.set(points, offset);
    
    return newBuffer;
}

export function applyChase(points, numPoints, params, time) {
    const { steps, decay, speed } = withDefaults(params, effectDefinitions.find(def => def.id === 'chase').defaultParams);
    
    // Simple segment chase: Divide the path into 'steps' segments.
    // Highlight one segment based on time.
    
    const t = time * 0.001 * speed;
    const activeStep = Math.floor(t % steps);
    const pointsPerStep = numPoints / steps;
    
    for(let i=0; i<numPoints; i++) {
        const stepIndex = Math.floor(i / pointsPerStep);
        const offset = i * 8;
        
        // Distance from active step
        let dist = Math.abs(stepIndex - activeStep);
        // Wrap around distance
        if (dist > steps / 2) dist = steps - dist;
        
        let intensity = 1.0;
        if (dist > 0) {
            intensity = Math.pow(decay, dist);
        }
        
        // Apply intensity to color
        points[offset+3] *= intensity;
        points[offset+4] *= intensity;
        points[offset+5] *= intensity;
        
        // If intensity is too low, maybe blank it?
        if (intensity < 0.1) points[offset+6] = 1; // Blank
    }
}

export function applyOutputProcessing(frame, settings) {
    if (!settings || !frame || !frame.points) return frame;
    
    const { safetyZones, outputArea, transformationEnabled, transformationMode } = settings;
    
    let points = frame.points;
    const isTyped = frame.isTypedArray || points instanceof Float32Array;
    const numPoints = isTyped ? (points.length / 8) : points.length;
    
    let newPoints;
    if (isTyped) {
        newPoints = new Float32Array(points);
    } else {
        newPoints = points.map(p => ({ ...p }));
    }

    for (let i = 0; i < numPoints; i++) {
        let x, y, r, g, b, blanking;
        if (isTyped) {
            x = newPoints[i*8];
            y = newPoints[i*8+1];
            r = newPoints[i*8+3];
            g = newPoints[i*8+4];
            b = newPoints[i*8+5];
            blanking = newPoints[i*8+6];
        } else {
            x = newPoints[i].x;
            y = newPoints[i].y;
            r = newPoints[i].r;
            g = newPoints[i].g;
            b = newPoints[i].b;
            blanking = newPoints[i].blanking ? 1 : 0;
        }

        // 1. Output Transformation (Crop/Scale)
        if (transformationEnabled && outputArea) {
            // Convert point to 0..1 (UI coords)
            let u = (x + 1) / 2;
            let v = (1 - y) / 2; // Y is flipped
            
            if (transformationMode === 'crop') {
                if (u < outputArea.x || u > outputArea.x + outputArea.w || 
                    v < outputArea.y || v > outputArea.y + outputArea.h) {
                    r = 0; g = 0; b = 0; blanking = 1;
                }
            } else if (transformationMode === 'scale') {
                // Map u from 0..1 to outputArea
                u = outputArea.x + (u * outputArea.w);
                v = outputArea.y + (v * outputArea.h);
                
                // Convert back to -1..1
                x = u * 2 - 1;
                y = 1 - (v * 2);
            }
        }

        // 2. Safety Zones
        if (safetyZones && safetyZones.length > 0) {
            let u = (x + 1) / 2;
            let v = (1 - y) / 2;
            
            for (const zone of safetyZones) {
                if (u >= zone.x && u <= zone.x + zone.w &&
                    v >= zone.y && v <= zone.y + zone.h) {
                    r = 0; g = 0; b = 0; blanking = 1;
                    break;
                }
            }
        }

        if (isTyped) {
            newPoints[i*8] = x;
            newPoints[i*8+1] = y;
            newPoints[i*8+3] = r;
            newPoints[i*8+4] = g;
            newPoints[i*8+5] = b;
            newPoints[i*8+6] = blanking;
        } else {
            newPoints[i].x = x;
            newPoints[i].y = y;
            newPoints[i].r = r;
            newPoints[i].g = g;
            newPoints[i].b = b;
            newPoints[i].blanking = blanking > 0.5;
        }
    }
    
    return { ...frame, points: newPoints, isTypedArray: isTyped };
}