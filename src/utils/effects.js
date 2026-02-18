import { effectDefinitions } from './effectDefinitions';

// Cache definitions by ID for O(1) lookup
const definitionsById = effectDefinitions.reduce((acc, def) => {
    acc[def.id] = def;
    return acc;
}, {});

const withDefaults = (params, defaults) => {
    // Optimization: If params already contains all keys, avoid spreading
    // For now, keep it simple but avoid calling this in the tightest loops if possible
    return { ...defaults, ...params };
};

function calculateAnimPhase(rawProgress, settings, baseValue, range) {
    const style = settings.style || 'loop';
    const direction = settings.direction || 'forward';
    if (direction === 'pause') return baseValue;

    let progress = rawProgress;
    if (style === 'bounce') {
        progress *= 2;
    }

    let animPhase = 0;
    if (style === 'once') {
        animPhase = Math.min(progress, 1.0);
        if (direction === 'backward') animPhase = 1.0 - animPhase;
    } else if (style === 'bounce') {
        let localPhase = progress % 1.0;
        const lap = Math.floor(progress);
        if (lap % 2 === 1) animPhase = 1.0 - localPhase;
        else animPhase = localPhase;
        if (direction === 'backward') animPhase = 1.0 - animPhase;
    } else {
        animPhase = progress % 1.0;
        if (direction === 'backward') animPhase = 1.0 - animPhase;
    }

    if (range && Array.isArray(range) && range.length === 2) {
        return range[0] + (range[1] - range[0]) * animPhase;
    }

    return baseValue;
}

// Helper to resolve animated parameter values
export function resolveParam(key, baseValue, animSettings, context, minVal, maxValue) {
    if (!animSettings) return baseValue;

    // Handle legacy simple string mode or object mode
    const settings = typeof animSettings === 'string' 
        ? { syncMode: animSettings } 
        : animSettings;
    
    if (!settings.syncMode) return baseValue;

    const { time, progress = 0, bpm = 120, clipDuration = 0, fftLevels = { low: 0, mid: 0, high: 0 }, activationTime = 0 } = context;
    
    // Resolve range
    let range = settings.range;
    if (!range || !Array.isArray(range) || range.length !== 2) {
        if (minVal !== undefined && maxValue !== undefined) {
            range = [minVal, maxValue];
        }
    }

    let rawProgress = 0;

    // 1. Calculate Raw Progress (Unwrapped, 0..infinity)
    const speedMult = settings.speedMultiplier || 1.0;
    const style = settings.style || 'loop';

    if (style === 'once' && activationTime > 0) {
        // Special case for 'once': use absolute time since activation
        const elapsed = (time - activationTime) * 0.001; // seconds
        // Map elapsed to progress using duration logic
        let duration = 1.0;
        if (settings.syncMode === 'timeline') {
            duration = Math.max(0.01, settings.duration || 1.0);
        } else if (settings.syncMode === 'bpm') {
            const paramBeats = Math.max(0.1, settings.beats || 4);
            const bps = bpm / 60;
            duration = paramBeats / (bps || 2);
        } else if (settings.syncMode === 'fps') {
            rawProgress = elapsed * speedMult;
            return calculateAnimPhase(rawProgress, settings, baseValue, range); 
        }
        
        rawProgress = (elapsed / duration) * speedMult;
    } else if (settings.syncMode === 'fps') {
        rawProgress = (time * 0.001 * speedMult);
    } else if (settings.syncMode === 'timeline') {
        const paramDur = Math.max(0.01, settings.duration || 1.0);
        if (clipDuration > 0) {
            const clipTime = progress * clipDuration;
            rawProgress = (clipTime / paramDur) * speedMult;
        } else {
            rawProgress = 0;
        }
    } else if (settings.syncMode === 'bpm') {
        const paramBeats = Math.max(0.1, settings.beats || 4);
        const bps = bpm / 60;
        const paramDur = paramBeats / (bps || 2); 

        if (clipDuration > 0) {
            const clipTime = progress * clipDuration;
            rawProgress = (clipTime / paramDur) * speedMult;
        } else {
            rawProgress = 0;
        }
    } else if (settings.syncMode === 'fft') {
        const level = fftLevels[settings.fftRange || 'low'] || 0;
        if (range) return range[0] + (range[1] - range[0]) * level;
        return baseValue;
    }

    return calculateAnimPhase(rawProgress, settings, baseValue, range);
}

function resolveFftValue(level, baseValue, settings) {
    const range = settings.range;
    if (range && Array.isArray(range) && range.length === 2) {
        return range[0] + (range[1] - range[0]) * level;
    }
    return baseValue;
}

// Internal buffer for processing to reduce GC pressure
let processingBuffer = new Float32Array(1024 * 8); 
function ensureBufferSize(numPoints) {
    if (processingBuffer.length < numPoints * 8) {
        processingBuffer = new Float32Array(numPoints * 8 * 2); // Double size for buffer room
    }
}

export function applyEffects(frame, effects, context = {}) {
  const { progress = 0, time = performance.now(), effectStates, syncSettings = {}, fftLevels } = context;

  if (!effects || effects.length === 0) return frame;

  const sourcePoints = frame.points;
  const isSourceTyped = frame.isTypedArray || sourcePoints instanceof Float32Array;
  const numPointsCount = isSourceTyped ? (sourcePoints.length / 8) : sourcePoints.length;
  
  ensureBufferSize(numPointsCount);
  const currentPoints = processingBuffer.subarray(0, numPointsCount * 8);

  // Copy source to processing buffer
  if (isSourceTyped) {
      currentPoints.set(sourcePoints);
  } else {
      for (let i = 0; i < numPointsCount; i++) {
          const p = sourcePoints[i];
          const offset = i * 8;
          currentPoints[offset] = p.x;
          currentPoints[offset + 1] = p.y;
          currentPoints[offset + 2] = p.z || 0;
          currentPoints[offset + 3] = p.r;
          currentPoints[offset + 4] = p.g;
          currentPoints[offset + 5] = p.b;
          currentPoints[offset + 6] = p.blanking ? 1 : 0;
          currentPoints[offset + 7] = p.lastPoint ? 1 : 0;
      }
  }

  let activePoints = currentPoints;

  for (const effect of effects) {
    const params = effect.params;
    if (params.enabled === false) continue;

    const definition = definitionsById[effect.id];
    if (!definition) continue;

    // Resolve current number of points based on current buffer
    const currentNumPoints = activePoints.length / 8;

    // Optimization: only resolve params if sync settings exist for this effect
    let resolvedParams = params;
    const instancePrefix = effect.instanceId ? `${effect.instanceId}.` : `${effect.id}.`;
    
    // Check if any param of this effect is synced
    let needsResolution = false;
    for (const key in params) {
        if (syncSettings[instancePrefix + key]) {
            needsResolution = true;
            break;
        }
    }

    if (needsResolution) {
        resolvedParams = { ...params };
        for (const key in resolvedParams) {
            const paramKey = instancePrefix + key;
            if (syncSettings[paramKey]) {
                 resolvedParams[key] = resolveParam(key, resolvedParams[key], syncSettings[paramKey], context);
            }
        }
    }

    switch (effect.id) {
      case 'rotate':
        applyRotate(activePoints, currentNumPoints, resolvedParams, progress, time);
        break;
      case 'scale':
        applyScale(activePoints, currentNumPoints, resolvedParams);
        break;
      case 'translate':
        applyTranslate(activePoints, currentNumPoints, resolvedParams);
        break;
      case 'color':
        applyColor(activePoints, currentNumPoints, resolvedParams, time);
        break;
      case 'wave':
        applyWave(activePoints, currentNumPoints, resolvedParams, time);
        break;
      case 'blanking':
        applyBlanking(activePoints, currentNumPoints, resolvedParams);
        break;
      case 'strobe':
        applyStrobe(activePoints, currentNumPoints, resolvedParams, time);
        break;
      case 'mirror':
        activePoints = applyMirror(activePoints, currentNumPoints, resolvedParams);
        break;
      case 'warp':
        applyWarp(activePoints, currentNumPoints, resolvedParams, time);
        break;
      case 'distortion':
        applyDistortion(activePoints, currentNumPoints, resolvedParams, time);
        break;
      case 'move':
        applyMove(activePoints, currentNumPoints, resolvedParams, time);
        break;
      case 'delay':
        if (effectStates && effect.instanceId) {
            activePoints = applyDelay(activePoints, currentNumPoints, resolvedParams, effectStates, effect.instanceId, context);
        }
        break;
      case 'chase':
        activePoints = applyChase(activePoints, currentNumPoints, resolvedParams, time, context);
        break;
    }
  }

  // Final result must be a NEW buffer because it's passed around, but we've reduced intermediate ones
  const finalPoints = new Float32Array(activePoints);
  if (activePoints._channelDistributions) {
      finalPoints._channelDistributions = activePoints._channelDistributions;
  }
  return { ...frame, points: finalPoints, isTypedArray: true };
}

function applyRotate(points, numPoints, params, progress, time) {
  const { angle, speed, direction } = params;
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
  const { scaleX, scaleY } = params;
  for (let i = 0; i < numPoints; i++) {
    const offset = i * 8;
    points[offset] *= scaleX;
    points[offset + 1] *= scaleY;
  }
}

function applyTranslate(points, numPoints, params) {
  const { translateX, translateY } = params;
  for (let i = 0; i < numPoints; i++) {
    const offset = i * 8;
    points[offset] += translateX;
    points[offset + 1] += translateY;
  }
}

function hexToRgb(hex) {
    if (!hex) return { r: 255, g: 255, b: 255 };
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 255, g: 255, b: 255 };
}

function hsvToRgb(h, s, v) {
    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    const d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) {
        h = 0;
    } else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h, s, v };
}

function applyColor(points, numPoints, params, time) {
  const { 
      mode, r, g, b, color, 
      hue, saturation, brightness,
      cycleSpeed, rainbowSpread, rainbowOffset, rainbowPalette,
      paletteColors = [], paletteSize = 4, paletteSpread = 1.0 
  } = params;
  const cycleTime = time * 0.001 * cycleSpeed;

  if (mode === 'palette') {
      // ... existing palette logic ...
      const activeCount = Math.min(paletteColors.length, paletteSize);
      const colors = paletteColors.slice(0, activeCount).map(hexToRgb);
      if (colors.length === 0) colors.push({r:255, g:255, b:255});
      
      for (let i = 0; i < numPoints; i++) {
          const offset = i * 8;
          const normalizedPos = ((i / numPoints * paletteSpread) + (cycleTime * 0.5) + (rainbowOffset / 360)) % 1.0;
          
          const scaledPos = normalizedPos * (colors.length);
          const index = Math.floor(scaledPos) % colors.length;
          const nextIndex = (index + 1) % colors.length;
          const factor = scaledPos - Math.floor(scaledPos);
          
          const c1 = colors[index];
          const c2 = colors[nextIndex];
          
          points[offset + 3] = Math.round(c1.r + (c2.r - c1.r) * factor);
          points[offset + 4] = Math.round(c1.g + (c2.g - c1.g) * factor);
          points[offset + 5] = Math.round(c1.b + (c2.b - c1.b) * factor);
      }
  } else if (mode === 'rainbow') {
    // ... existing rainbow logic ...
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
    let fr = r, fg = g, fb = b;
    
    // HSV Parameters take priority for animation
    if (hue !== undefined && saturation !== undefined && brightness !== undefined) {
        [fr, fg, fb] = hsvToRgb(hue, saturation, brightness);
    } else if (color) {
        const c = hexToRgb(color);
        fr = c.r; fg = c.g; fb = c.b;
    }

    if (cycleSpeed > 0) {
      const hueCycle = (cycleTime * 50) % 360;
      const [cr, cg, cb] = hslToRgb(hueCycle / 360, 1, 0.5);
      for (let i = 0; i < numPoints; i++) {
        const offset = i * 8;
        points[offset + 3] = cr;
        points[offset + 4] = cg;
        points[offset + 5] = cb;
      }
    } else {
      for (let i = 0; i < numPoints; i++) {
        const offset = i * 8;
        points[offset + 3] = fr;
        points[offset + 4] = fg;
        points[offset + 5] = fb;
      }
    }
  }
}

function getPaletteColor(paletteName, pos) {
  const palettes = {
    'fire': [{ r: 255, g: 0, b: 0 }, { r: 255, g: 128, b: 0 }, { r: 255, g: 255, b: 0 }, { r: 255, g: 0, b: 0 }],
    'ice': [{ r: 0, g: 0, b: 255 }, { r: 0, g: 255, b: 255 }, { r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 255 }],
    'cyber': [{ r: 255, g: 0, b: 255 }, { r: 0, g: 255, b: 255 }, { r: 0, g: 0, b: 255 }, { r: 255, g: 0, b: 255 }]
  };
  const colors = palettes[paletteName] || palettes['fire'];
  const scaledPos = pos * (colors.length - 1);
  const index = Math.floor(scaledPos);
  const factor = scaledPos - index;
  const c1 = colors[index];
  const c2 = colors[index + 1] || colors[index];
  return [Math.round(c1.r + (c2.r - c1.r) * factor), Math.round(c1.g + (c2.g - c1.g) * factor), Math.round(c1.b + (c2.b - c1.b) * factor)];
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
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
  const { amplitude, frequency, speed, direction } = params;
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
  const { blankingInterval, spacing = 0 } = params;
  if (blankingInterval <= 0) return;
  const step = blankingInterval + 1 + spacing;
  for (let i = 0; i < numPoints; i++) {
    if ((i % step) >= blankingInterval) {
        points[i * 8 + 6] = 1;
    }
  }
}

function applyStrobe(points, numPoints, params, time) {
  const { strobeSpeed, strobeAmount } = params;
  const cyclePosition = (time % strobeSpeed) / strobeSpeed;
  if (cyclePosition < strobeAmount) {
    for (let i = 0; i < numPoints; i++) {
        points[i * 8 + 6] = 1;
    }
  }
}

function applyMirror(points, numPoints, params) {
  const { mode, additive = true, axisOffset = 0, planeRotation = 0 } = params;
  if (mode === 'none' || numPoints === 0) return points;
  
  const angleRad = planeRotation * Math.PI / 180;

  const rotatePoint = (x, y, angle) => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return { x: x * cos - y * sin, y: x * sin + y * cos };
  };

  const getMirroredCoords = (x, y) => {
      let px = x, py = y;
      if (angleRad !== 0) {
          const rot = rotatePoint(x, y, -angleRad);
          px = rot.x; py = rot.y;
      }
      if (mode === 'x-' || mode === 'x+') px = 2 * axisOffset - px;
      else if (mode === 'y-' || mode === 'y+') py = 2 * axisOffset - py;
      if (angleRad !== 0) {
          const rot = rotatePoint(px, py, angleRad);
          px = rot.x; py = rot.y;
      }
      return { x: px, y: py };
  };

  const filterPoint = (x, y) => {
      if (additive) return true;
      let px = x, py = y;
      if (angleRad !== 0) {
          const rot = rotatePoint(x, y, -angleRad);
          px = rot.x; py = rot.y;
      }
      if (mode === 'x+') return px >= axisOffset;
      if (mode === 'x-') return px <= axisOffset;
      if (mode === 'y+') return py >= axisOffset;
      if (mode === 'y-') return py <= axisOffset;
      return true;
  };

  let newBuffer;
  const distributions = points._channelDistributions;

  if (distributions) {
      newBuffer = new Float32Array((numPoints * 2 + distributions.size * 2 + 50) * 8);
      const newDists = new Map();
      let currentOffset = 0;

      for (const [id, dist] of distributions) {
          const sliceNumPoints = dist.length / 8;
          const sliceStart = dist.start;
          const targetStart = currentOffset;
          let keptInSlice = 0;
          let lastWasIn = true;

          // 1. Original (filtered)
          for (let i = 0; i < sliceNumPoints; i++) {
              const off = sliceStart + i * 8;
              const isIn = filterPoint(points[off], points[off+1]);
              if (isIn) {
                  if (!lastWasIn && keptInSlice > 0) {
                      newBuffer.set(points.subarray(off, off + 8), currentOffset);
                      newBuffer[currentOffset + 6] = 1;
                      newBuffer[currentOffset + 3] = 0; newBuffer[currentOffset + 4] = 0; newBuffer[currentOffset + 5] = 0;
                      currentOffset += 8;
                      keptInSlice++;
                  }
                  newBuffer.set(points.subarray(off, off + 8), currentOffset);
                  currentOffset += 8;
                  keptInSlice++;
              }
              lastWasIn = isIn;
          }

          if (keptInSlice > 0) {
              // 2. Bridge (at current position, blanked)
              const lastKeptOff = currentOffset - 8;
              newBuffer.set(newBuffer.subarray(lastKeptOff, lastKeptOff + 8), currentOffset);
              newBuffer[currentOffset + 6] = 1;
              newBuffer[currentOffset + 3] = 0; newBuffer[currentOffset + 4] = 0; newBuffer[currentOffset + 5] = 0;
              currentOffset += 8;

              // 3. Mirrored (with shifted blanking)
              let lastWasInMirror = true;
              let mirrorKeptCount = 0;
              for (let i = sliceNumPoints - 1; i >= 0; i--) {
                  const off = sliceStart + i * 8;
                  const isIn = filterPoint(points[off], points[off+1]);
                  if (isIn) {
                      // Bridge within mirrored part (if a point was filtered out)
                      if (!lastWasInMirror && mirrorKeptCount > 0) {
                          newBuffer.set(points.subarray(off, off + 8), currentOffset);
                          const m = getMirroredCoords(newBuffer[currentOffset], newBuffer[currentOffset+1]);
                          newBuffer[currentOffset] = m.x; newBuffer[currentOffset+1] = m.y;
                          newBuffer[currentOffset + 6] = 1;
                          newBuffer[currentOffset + 3] = 0; newBuffer[currentOffset + 4] = 0; newBuffer[currentOffset + 5] = 0;
                          currentOffset += 8;
                      }

                      newBuffer.set(points.subarray(off, off + 8), currentOffset);
                      const dstOff = currentOffset;
                      const m = getMirroredCoords(newBuffer[dstOff], newBuffer[dstOff+1]);
                      newBuffer[dstOff] = m.x; newBuffer[dstOff+1] = m.y;
                      
                      // BLANKING SHIFT: Mirrored segment blanking comes from the original's next point
                      if (i === sliceNumPoints - 1) {
                          newBuffer[dstOff + 6] = 1; // First mirrored point always blanked
                          newBuffer[dstOff + 3] = 0; newBuffer[dstOff + 4] = 0; newBuffer[dstOff + 5] = 0;
                      } else {
                          newBuffer[dstOff + 6] = points[off + 8 + 6];
                      }

                      currentOffset += 8;
                      mirrorKeptCount++;
                  }
                  lastWasInMirror = isIn;
              }
              newDists.set(id, { start: targetStart, length: (currentOffset - targetStart) });
          }
      }
      const finalBuffer = new Float32Array(currentOffset);
      finalBuffer.set(newBuffer.subarray(0, currentOffset));
      finalBuffer._channelDistributions = newDists;
      return finalBuffer;
  } else {
      newBuffer = new Float32Array((numPoints * 2 + 50) * 8);
      let currentOffset = 0;
      let keptPoints = 0;
      let lastWasIn = true;

      for (let i = 0; i < numPoints; i++) {
          const off = i * 8;
          const isIn = filterPoint(points[off], points[off+1]);
          if (isIn) {
              if (!lastWasIn && keptPoints > 0) {
                  newBuffer.set(points.subarray(off, off + 8), currentOffset);
                  newBuffer[currentOffset+6] = 1;
                  newBuffer[currentOffset+3] = 0; newBuffer[currentOffset+4] = 0; newBuffer[currentOffset+5] = 0;
                  currentOffset += 8;
                  keptPoints++;
              }
              newBuffer.set(points.subarray(off, off + 8), currentOffset);
              currentOffset += 8;
              keptPoints++;
          }
          lastWasIn = isIn;
      }

      if (keptPoints > 0) {
          // 2. Bridge (at current position, blanked)
          const lastKeptOff = currentOffset - 8;
          newBuffer.set(newBuffer.subarray(lastKeptOff, lastKeptOff + 8), currentOffset);
          newBuffer[currentOffset + 6] = 1;
          newBuffer[currentOffset + 3] = 0; newBuffer[currentOffset + 4] = 0; newBuffer[currentOffset + 5] = 0;
          currentOffset += 8;

          // 3. Mirrored (with shifted blanking)
          let lastWasInMirror = true;
          let mirrorKeptCount = 0;
          for (let i = numPoints - 1; i >= 0; i--) {
              const off = i * 8;
              const isIn = filterPoint(points[off], points[off+1]);
              if (isIn) {
                  // Bridge within mirrored part (if a point was filtered out)
                  if (!lastWasInMirror && mirrorKeptCount > 0) {
                      newBuffer.set(points.subarray(off, off + 8), currentOffset);
                      const m = getMirroredCoords(newBuffer[currentOffset], newBuffer[currentOffset+1]);
                      newBuffer[currentOffset] = m.x; newBuffer[currentOffset+1] = m.y;
                      newBuffer[currentOffset+6] = 1;
                      newBuffer[currentOffset+3] = 0; newBuffer[currentOffset+4] = 0; newBuffer[currentOffset+5] = 0;
                      currentOffset += 8;
                  }

                  newBuffer.set(points.subarray(off, off + 8), currentOffset);
                  const dstOff = currentOffset;
                  const m = getMirroredCoords(newBuffer[dstOff], newBuffer[dstOff+1]);
                  newBuffer[dstOff] = m.x; newBuffer[dstOff+1] = m.y;

                  // BLANKING SHIFT: Mirrored segment blanking comes from the original's next point
                  if (i === numPoints - 1) {
                      newBuffer[dstOff + 6] = 1; // First mirrored point always blanked
                      newBuffer[dstOff + 3] = 0; newBuffer[dstOff + 4] = 0; newBuffer[dstOff + 5] = 0;
                  } else {
                      newBuffer[dstOff + 6] = points[off + 8 + 6];
                  }

                  currentOffset += 8;
                  mirrorKeptCount++;
              }
              lastWasInMirror = isIn;
          }
      }
      return newBuffer.slice(0, currentOffset);
  }
}

function applyWarp(points, numPoints, params, time) {
    const { amount, chaos, speed } = params;
    const t = time * 0.001 * speed;
    for(let i=0; i<numPoints; i++) {
        const off = i*8;
        const x = points[off]; const y = points[off+1];
        const symY = Math.abs(y);
        points[off] += Math.sin(symY * 10 * (1+chaos) + t) * amount * Math.cos(t * chaos);
        points[off+1] += Math.cos(Math.abs(x) * 10 * (1+chaos) + t) * amount * Math.sin(t * chaos);
    }
}

function applyDistortion(points, numPoints, params, time) {
   const { amount, scale, speed } = params;
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
    const { speedX, speedY } = params;
    const t = time * 0.001;
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
        points[off] = x; points[off+1] = y;
    }
}

function applyDelay(points, numPoints, params, effectStates, instanceId, context) {
    const { mode = 'segment', delayAmount, decay, delayDirection, useCustomOrder, customOrder, playstyle = 'repeat', steps = 10 } = params;
    if (!effectStates.has(instanceId)) effectStates.set(instanceId, []);
    const history = effectStates.get(instanceId);
    history.unshift(new Float32Array(points));

    if (mode === 'segment') {
        const maxHistory = delayAmount * steps + 1;
        if (history.length > maxHistory) history.length = maxHistory;
        const newPoints = new Float32Array(points.length);
        for (let i = 0; i < numPoints; i++) {
            let step = 0;
            const norm = i / numPoints;
            if (delayDirection === 'left_to_right') step = Math.floor(norm * steps);
            else if (delayDirection === 'right_to_left') step = Math.floor((1 - norm) * steps);
            else if (delayDirection === 'center_to_out') step = Math.floor(Math.abs(norm - 0.5) * 2 * steps);
            else if (delayDirection === 'out_to_center') step = Math.floor((1 - Math.abs(norm - 0.5) * 2) * steps);
            step = Math.min(steps - 1, Math.max(0, step));

            const idx = step * delayAmount;
            const echo = (idx < history.length) ? history[idx] : null;
            const factor = Math.pow(decay, step);
            const off = i * 8;

            if (echo && echo.length > 0) {
                let echoOff;
                if (echo.length === points.length) {
                    echoOff = off;
                } else {
                    const echoNumPoints = echo.length / 8;
                    let echoIdx = Math.floor(norm * echoNumPoints);
                    if (echoIdx >= echoNumPoints) echoIdx = echoNumPoints - 1;
                    echoOff = echoIdx * 8;
                }

                newPoints[off] = echo[echoOff]; 
                newPoints[off+1] = echo[echoOff+1]; 
                newPoints[off+2] = echo[echoOff+2];
                newPoints[off+3] = echo[echoOff+3] * factor; 
                newPoints[off+4] = echo[echoOff+4] * factor; 
                newPoints[off+5] = echo[echoOff+5] * factor;
                
                // CRITICAL: Preserve blanking from current frame (e.g. Mirror bridges) 
                // OR use the blanking from the echo frame.
                const inputBlanked = points[off+6] > 0.5;
                newPoints[off+6] = inputBlanked ? 1 : echo[echoOff+6]; 
                if (newPoints[off+6] > 0.5) {
                    newPoints[off+3] = 0; newPoints[off+4] = 0; newPoints[off+5] = 0;
                }

                newPoints[off+7] = echo[echoOff+7];

                // 2-POINT BLANKING BRIDGE for step transitions
                if (i > 0) {
                    const prevNorm = (i - 1) / numPoints;
                    let prevStep = 0;
                    if (delayDirection === 'left_to_right') prevStep = Math.floor(prevNorm * steps);
                    else if (delayDirection === 'right_to_left') prevStep = Math.floor((1 - prevNorm) * steps);
                    else if (delayDirection === 'center_to_out') prevStep = Math.floor(Math.abs(prevNorm - 0.5) * 2 * steps);
                    else if (delayDirection === 'out_to_center') prevStep = Math.floor((1 - Math.abs(prevNorm - 0.5) * 2) * steps);
                    prevStep = Math.min(steps - 1, Math.max(0, prevStep));
                    
                    if (prevStep !== step) {
                        // 1. Blank the destination point
                        newPoints[off+6] = 1; 
                        newPoints[off+3] = 0; newPoints[off+4] = 0; newPoints[off+5] = 0;

                        // 2. Blank the source point (previous point)
                        const prevOff = (i - 1) * 8;
                        newPoints[prevOff+6] = 1;
                        newPoints[prevOff+3] = 0; newPoints[prevOff+4] = 0; newPoints[prevOff+5] = 0;
                    }
                }
            } else {
                newPoints.set(points.subarray(off, off+8), off);
                newPoints[off+3] = 0; newPoints[off+4] = 0; newPoints[off+5] = 0; newPoints[off+6] = 1;
            }
        }
        if (points._channelDistributions) newPoints._channelDistributions = points._channelDistributions;
        return newPoints;
    } else if (mode === 'frame') {
        const numEchoes = steps;
        const maxHistory = delayAmount * numEchoes + 1;
        if (history.length > maxHistory) history.length = maxHistory;

        const echoes = [];
        for (let k = 0; k < numEchoes; k++) {
            const index = k * delayAmount;
            const echoPoints = (index < history.length) ? history[index] : null;
            echoes.push({
                points: echoPoints,
                factor: Math.pow(decay, k)
            });
        }

        // Calculate total points needed: (original points * numEchoes) + (numEchoes - 1) bridges
        const totalPointsPerEcho = points.length / 8;
        const totalPointsNeeded = (totalPointsPerEcho * numEchoes) + (numEchoes > 0 ? numEchoes - 1 : 0);
        const newPoints = new Float32Array(totalPointsNeeded * 8);
        let currentOffset = 0;

        for (let k = 0; k < echoes.length; k++) {
            const echo = echoes[k];
            const src = echo.points || points;
            const factor = echo.factor;
            const srcNumPoints = src.length / 8;

            // Copy echo points
            for (let i = 0; i < srcNumPoints; i++) {
                const srcOff = i * 8;
                const dstOff = currentOffset + i * 8;
                newPoints[dstOff] = src[srcOff];
                newPoints[dstOff+1] = src[srcOff+1];
                newPoints[dstOff+2] = src[srcOff+2];
                newPoints[dstOff+3] = src[srcOff+3] * factor;
                newPoints[dstOff+4] = src[srcOff+4] * factor;
                newPoints[dstOff+5] = src[srcOff+5] * factor;
                newPoints[dstOff+6] = src[srcOff+6];
                newPoints[dstOff+7] = src[srcOff+7];
            }
            currentOffset += srcNumPoints * 8;

            // Add blanked bridge point after echo (except for the very last one)
            if (k < echoes.length - 1) {
                const lastSrcOff = (srcNumPoints - 1) * 8;
                const bridgeOff = currentOffset;
                newPoints[bridgeOff] = src[lastSrcOff];
                newPoints[bridgeOff+1] = src[lastSrcOff+1];
                newPoints[bridgeOff+2] = src[lastSrcOff+2];
                newPoints[bridgeOff+3] = 0;
                newPoints[bridgeOff+4] = 0;
                newPoints[bridgeOff+5] = 0;
                newPoints[bridgeOff+6] = 1;
                newPoints[bridgeOff+7] = 0;
                currentOffset += 8;
            }
        }

        if (points._channelDistributions) newPoints._channelDistributions = points._channelDistributions;
        return newPoints;
    } else {
        const { assignedDacs } = context || {};
        let channelDelayMap = new Map();
        let maxStep = 0;
        const isCustom = useCustomOrder || params.delayMode === 'channel';
        if (isCustom) {
            const list = (customOrder && customOrder.length > 0) ? customOrder.map(item => item.originalIndex) : (assignedDacs ? assignedDacs.map((_, i) => i) : [0]);
            list.forEach((dacIdx, step) => { channelDelayMap.set(dacIdx, step); maxStep = Math.max(maxStep, step); });
        } else {
            const dacs = assignedDacs || [];
            const N = dacs.length || 1;
            for(let i=0; i<N; i++) {
                let step = i;
                if (delayDirection === 'right_to_left') step = N - 1 - i;
                else if (delayDirection === 'center_to_out') step = Math.floor(Math.abs(i - (N - 1) / 2));
                else if (delayDirection === 'out_to_center') step = Math.min(i, N - 1 - i);
                channelDelayMap.set(i, step); maxStep = Math.max(maxStep, step);
            }
        }
        const numEchoes = maxStep + 1;
        const maxHistory = delayAmount * numEchoes + 1;
        if (history.length > maxHistory) history.length = maxHistory;
        const echoes = [];
        for(let k=0; k<numEchoes; k++) {
            const index = k * delayAmount;
            echoes.push({ points: (index < history.length) ? history[index] : null, factor: Math.pow(decay, k), index: k });
        }
        const totalPoints = echoes.reduce((sum, e) => sum + (e.points ? e.points.length / 8 : points.length / 8), 0);
        const newBuffer = new Float32Array(totalPoints * 8);
        let offset = 0;
        const echoOffsets = new Array(echoes.length);
        for (let k = 0; k < echoes.length; k++) {
            const echo = echoes[k]; const ePoints = echo.points; const eNum = ePoints ? ePoints.length / 8 : points.length / 8;
            echoOffsets[k] = offset;
            for(let i=0; i<eNum; i++) {
                const srcOff = i*8; const dstOff = offset + i*8;
                if (ePoints) {
                    newBuffer[dstOff] = ePoints[srcOff]; newBuffer[dstOff+1] = ePoints[srcOff+1]; newBuffer[dstOff+2] = ePoints[srcOff+2];
                    newBuffer[dstOff+3] = ePoints[srcOff+3] * echo.factor; newBuffer[dstOff+4] = ePoints[srcOff+4] * echo.factor; newBuffer[dstOff+5] = ePoints[srcOff+5] * echo.factor;
                    newBuffer[dstOff+6] = ePoints[srcOff+6]; newBuffer[dstOff+7] = ePoints[srcOff+7];
                } else {
                    newBuffer[dstOff+6] = 1;
                }
            }
            offset += eNum * 8;
        }
        const distributions = new Map();
        channelDelayMap.forEach((step, dacIndex) => {
            if (step < echoes.length) distributions.set(dacIndex, { start: echoOffsets[step], length: echoes[step].points ? echoes[step].points.length : points.length });
        });
        newBuffer._channelDistributions = distributions;
        return newBuffer;
    }
}

export function applyChase(points, numPoints, params, time, context = {}) {
    const { mode = 'segment', steps: paramSteps, decay, speed, overlap, direction, useCustomOrder, customOrder, playstyle = 'loop' } = params;
    const { progress = 0, clipDuration = 1, syncSettings = {} } = context;
    
    // Check if THIS specific parameter ('speed') is synced
    const instancePrefix = params.instanceId ? `${params.instanceId}.` : 'chase.';
    const isSpeedSynced = !!syncSettings[instancePrefix + 'speed'];
    const useSync = (progress !== undefined && clipDuration > 0) || isSpeedSynced;

    if (mode === 'segment') {
        const steps = paramSteps;
        // If synced, map 0..1 progress to 0..steps. If free, map 1s to 1 step.
        let t = (useSync ? (progress * steps) : (time * 0.001)) * speed;

        if (playstyle === 'bounce') {
             const range = steps;
             const cycle = t % (range * 2);
             t = cycle > range ? (range * 2) - cycle : cycle;
        } else if (playstyle === 'once') {
             t = Math.min(t, steps);
        } else {
             t = t % steps;
        }
        
        const newPoints = new Float32Array(points.length);
        for (let i = 0; i < numPoints; i++) {
            const norm = i / numPoints;
            let stepIndex = 0;
            if (direction === 'left_to_right') stepIndex = Math.min(steps - 1, Math.floor(norm * steps));
            else if (direction === 'right_to_left') stepIndex = Math.min(steps - 1, Math.floor((1 - norm) * steps));
            else if (direction === 'center_to_out') stepIndex = Math.min(steps - 1, Math.floor(Math.abs(norm - 0.5) * 2 * steps));
            else if (direction === 'out_to_center') stepIndex = Math.min(steps - 1, Math.floor((1 - Math.abs(norm - 0.5) * 2) * steps));

            let dist = Math.abs(t - stepIndex);
            if (dist > steps / 2) dist = steps - dist;
            let intensity = (dist < overlap) ? (1.0 - (dist / overlap)) : 0;
            if (decay > 0) intensity = Math.pow(intensity, 1 - decay);
            
            const off = i * 8;
            newPoints.set(points.subarray(off, off + 8), off);
            
            // Apply chase intensity
            newPoints[off+3] *= intensity; newPoints[off+4] *= intensity; newPoints[off+5] *= intensity;
            
            // CRITICAL: Preserve blanking if the current point is already blanked (e.g. Mirror bridge)
            if (intensity < 0.05 || points[off+6] > 0.5) {
                newPoints[off+6] = 1;
                newPoints[off+3] = 0; newPoints[off+4] = 0; newPoints[off+5] = 0;
            }

            // 2-POINT BLANKING BRIDGE for chase step transitions
            if (i > 0) {
                const prevNorm = (i - 1) / numPoints;
                let prevStepIndex = 0;
                if (direction === 'left_to_right') prevStepIndex = Math.min(steps - 1, Math.floor(prevNorm * steps));
                else if (direction === 'right_to_left') prevStepIndex = Math.min(steps - 1, Math.floor((1 - prevNorm) * steps));
                else if (direction === 'center_to_out') prevStepIndex = Math.min(steps - 1, Math.floor(Math.abs(prevNorm - 0.5) * 2 * steps));
                else if (direction === 'out_to_center') prevStepIndex = Math.min(steps - 1, Math.floor((1 - Math.abs(prevNorm - 0.5) * 2) * steps));
                
                if (prevStepIndex !== stepIndex) {
                    // 1. Blank the destination point
                    newPoints[off+6] = 1; 
                    newPoints[off+3] = 0; newPoints[off+4] = 0; newPoints[off+5] = 0;

                    // 2. Blank the source point (previous point)
                    const prevOff = (i - 1) * 8;
                    newPoints[prevOff+6] = 1;
                    newPoints[prevOff+3] = 0; newPoints[prevOff+4] = 0; newPoints[prevOff+5] = 0;
                }
            }
        }
        if (points._channelDistributions) newPoints._channelDistributions = points._channelDistributions;
        return newPoints;
    } else {
        const { assignedDacs } = context || {};
        let channelStepMap = new Map();
        let numChannels = 0;
        if (useCustomOrder) {
            const list = (customOrder && customOrder.length > 0) ? customOrder.map(item => item.originalIndex) : (assignedDacs ? assignedDacs.map((_, i) => i) : [0]);
            list.forEach((dacIdx, stepIndex) => { channelStepMap.set(dacIdx, stepIndex); numChannels++; });
        } else {
            numChannels = (assignedDacs ? assignedDacs.length : 1) || 1;
            for(let i=0; i<numChannels; i++) {
                let step = i;
                if (direction === 'right_to_left') step = numChannels - 1 - i;
                else if (direction === 'center_to_out') step = Math.floor(Math.abs(i - (numChannels - 1) / 2));
                else if (direction === 'out_to_center') step = Math.min(i, numChannels - 1 - i);
                channelStepMap.set(i, step);
            }
        }
        const cycleLength = numChannels;
        // If synced, map 0..1 progress to 0..numChannels. If free, map 1s to 1 step.
        let t = (useSync ? (progress * cycleLength) : (time * 0.001)) * speed;
        
        if (playstyle === 'bounce') {
             const range = cycleLength;
             const cycle = t % (range * 2);
             t = cycle > range ? (range * 2) - cycle : cycle;
        } else if (playstyle === 'once') {
             t = Math.min(t, cycleLength);
        } else {
             t = t % cycleLength;
        }

        const totalPoints = numPoints * numChannels;
        const newBuffer = new Float32Array(totalPoints * 8);
        const distributions = new Map();
        let offset = 0;
        const dacIndices = Array.from(channelStepMap.keys());
        if (dacIndices.length === 0) dacIndices.push(0);
        for (const dacIndex of dacIndices) {
            const stepIndex = channelStepMap.get(dacIndex) || 0;
            let dist = Math.abs(t - stepIndex);
            if (dist > cycleLength / 2) dist = cycleLength - dist;
            let intensity = (dist < overlap) ? (1.0 - (dist / overlap)) : 0;
            if (decay > 0) intensity = Math.pow(intensity, 1 - decay);
            const startOffset = offset;
            for (let i = 0; i < numPoints; i++) {
                const srcOff = i * 8; const dstOff = offset + i * 8;
                newBuffer.set(points.subarray(srcOff, srcOff + 8), dstOff);
                newBuffer[dstOff+3] *= intensity; newBuffer[dstOff+4] *= intensity; newBuffer[dstOff+5] *= intensity;
                if (intensity < 0.05) newBuffer[dstOff+6] = 1;
            }
            distributions.set(dacIndex, { start: startOffset, length: numPoints * 8 });
            offset += numPoints * 8;
        }
        newBuffer._channelDistributions = distributions;
        return newBuffer;
    }
}

export function applyOutputProcessing(frame, settings, inPlace = false) {
    if (!settings || !frame || !frame.points) return frame;
    const { safetyZones, outputArea, transformationEnabled, transformationMode, flipX, flipY } = settings;
    let points = frame.points;
    const isTyped = frame.isTypedArray || points instanceof Float32Array;
    const numPoints = isTyped ? (points.length / 8) : points.length;
    
    // Optimization: If inPlace is true, we modify the points array directly to avoid allocation
    let newPoints = inPlace ? points : (isTyped ? new Float32Array(points) : points.map(p => ({ ...p })));

    for (let i = 0; i < numPoints; i++) {
        let x, y, r, g, b, blanking;
        if (isTyped) { 
            x = newPoints[i*8]; y = newPoints[i*8+1]; 
            r = newPoints[i*8+3]; g = newPoints[i*8+4]; b = newPoints[i*8+5]; 
            blanking = newPoints[i*8+6]; 
        } else { 
            x = newPoints[i].x; y = newPoints[i].y; 
            r = newPoints[i].r; g = newPoints[i].g; b = newPoints[i].b; 
            blanking = newPoints[i].blanking ? 1 : 0; 
        }

        // 1. Apply Transformation (Scale/Crop)
        if (transformationEnabled && outputArea) {
            let u = (x + 1) / 2; 
            let v = (1 - y) / 2; // Flip Y for V coordinate (0 at top)
            
            if (transformationMode === 'crop') { 
                if (u < outputArea.x || u > outputArea.x + outputArea.w || v < outputArea.y || v > outputArea.y + outputArea.h) { 
                    r = 0; g = 0; b = 0; blanking = 1; 
                } 
            } else if (transformationMode === 'scale') { 
                u = outputArea.x + (u * outputArea.w); 
                v = outputArea.y + (v * outputArea.h); 
                x = u * 2 - 1; 
                y = 1 - (v * 2); 
            }
        }

        // 2. Apply Safety Zones (Check against TRANSFORMED coordinates)
        if (safetyZones && safetyZones.length > 0) {
            let u = (x + 1) / 2; 
            let v = (1 - y) / 2;
            for (const zone of safetyZones) { 
                if (u >= zone.x && u <= zone.x + zone.w && v >= zone.y && v <= zone.y + zone.h) { 
                    r = 0; g = 0; b = 0; blanking = 1; break; 
                } 
            }
        }

        // 3. Hardware Correction (Flip) - MUST BE LAST
        if (flipX) x = -x; 
        if (flipY) y = -y;

        // 4. Clamping - Prevent hardware wraparound/halo effects
        x = Math.max(-1, Math.min(1, x));
        y = Math.max(-1, Math.min(1, y));

        if (isTyped) { 
            newPoints[i*8] = x; newPoints[i*8+1] = y; 
            newPoints[i*8+3] = r; newPoints[i*8+4] = g; newPoints[i*8+5] = b; 
            newPoints[i*8+6] = blanking; 
        } else { 
            newPoints[i].x = x; newPoints[i].y = y; 
            newPoints[i].r = r; newPoints[i].g = g; newPoints[i].b = b; 
            newPoints[i].blanking = blanking > 0.5; 
        }
    }
    return { ...frame, points: newPoints, isTypedArray: isTyped };
}
