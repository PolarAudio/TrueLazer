import { effectDefinitions } from './effectDefinitions';

const withDefaults = (params, defaults) => ({ ...defaults, ...params });

// Helper to resolve animated parameter values
export function resolveParam(key, baseValue, animSettings, context) {
    if (!animSettings) return baseValue;

    // Handle legacy simple string mode or object mode
    const settings = typeof animSettings === 'string' 
        ? { syncMode: animSettings } 
        : animSettings;
    
    if (!settings.syncMode) return baseValue;

    const { time, progress = 0, bpm = 120, clipDuration = 0, fftLevels = { low: 0, mid: 0, high: 0 }, activationTime = 0 } = context;
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
            // For FPS mode, rawProgress was (time * speed)
            // Here we want (elapsed * speed)
            rawProgress = elapsed * speedMult;
            return calculateAnimPhase(rawProgress, settings, baseValue); // Helper to avoid duplicate logic
        }
        
        rawProgress = (elapsed / duration) * speedMult;
        // Don't return yet, let it flow to animPhase logic, but ensure syncMode logic doesn't overwrite it?
        // Actually, the block below overwrites rawProgress. We need to restructure.
    } else if (settings.syncMode === 'fps') {
        // FPS Mode: Free running based on Time * Speed
        // Base rate: 1 cycle per second
        rawProgress = (time * 0.001 * speedMult);

    } else if (settings.syncMode === 'timeline') {
        // Timeline Mode: Synced to Clip Progress
        // Param Duration (s)
        const paramDur = Math.max(0.01, settings.duration || 1.0);
        
        // If we have clip duration, we can map clip progress to parameter cycles
        if (clipDuration > 0) {
            const clipTime = progress * clipDuration;
            rawProgress = (clipTime / paramDur) * speedMult;
        } else {
            rawProgress = 0;
        }

    } else if (settings.syncMode === 'bpm') {
        // BPM Mode: Synced to Clip Progress but scaled by Beats
        const paramBeats = Math.max(0.1, settings.beats || 4);
        const bps = bpm / 60;
        const paramDur = paramBeats / (bps || 2); // Duration in Seconds

        if (clipDuration > 0) {
            const clipTime = progress * clipDuration;
            rawProgress = (clipTime / paramDur) * speedMult;
        } else {
            rawProgress = 0;
        }
    } else if (settings.syncMode === 'fft') {
        const range = settings.fftRange || 'low';
        const level = fftLevels[range] || 0;
        return resolveFftValue(level, baseValue, settings);
    }

    // Adjust rawProgress for Bounce style so a full cycle (up+down) fits in the duration
    if (style === 'bounce') {
        rawProgress *= 2;
    }

    // 2. Apply Direction
    const direction = settings.direction || 'forward';
    if (direction === 'pause') {
        return baseValue; 
    }

    // 3. Apply Style (Loop, Bounce, Once)
    let animPhase = 0;

    if (style === 'once') {
        animPhase = Math.min(rawProgress, 1.0);
        if (direction === 'backward') animPhase = 1.0 - animPhase;
    } else if (style === 'bounce') {
        let localPhase = rawProgress % 1.0;
        const lap = Math.floor(rawProgress);
        if (lap % 2 === 1) animPhase = 1.0 - localPhase;
        else animPhase = localPhase;
        if (direction === 'backward') animPhase = 1.0 - animPhase;
    } else {
        animPhase = rawProgress % 1.0;
        if (direction === 'backward') animPhase = 1.0 - animPhase;
    }

    // 4. Map to Range
    const range = settings.range; 
    let min = 0, max = 1;
    if (range && Array.isArray(range) && range.length === 2) {
        min = range[0];
        max = range[1];
    } else {
        return baseValue;
    }

    return min + (max - min) * animPhase;
}

function resolveFftValue(level, baseValue, settings) {
    const range = settings.range;
    if (range && Array.isArray(range) && range.length === 2) {
        return range[0] + (range[1] - range[0]) * level;
    }
    return baseValue;
}

export function applyEffects(frame, effects, context = {}) {
  const { progress = 0, time = performance.now(), effectStates, syncSettings = {}, fftLevels } = context;

  if (!effects || effects.length === 0) return frame;

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
      pointsData = new Float32Array(frame.points);
  }

  let currentPoints = pointsData;
  const numPoints = () => currentPoints.length / 8;

  for (const effect of effects) {
    if (effect.params.enabled === false) continue;

    const definition = effectDefinitions.find(def => def.id === effect.id);
    if (!definition) continue;

    const resolvedParams = { ...effect.params };
    for (const key of Object.keys(resolvedParams)) {
        const paramKey = effect.instanceId ? `${effect.instanceId}.${key}` : `${effect.id}.${key}`;
        if (syncSettings[paramKey]) {
             resolvedParams[key] = resolveParam(key, resolvedParams[key], syncSettings[paramKey], context);
        }
    }

    switch (effect.id) {
      case 'rotate':
        applyRotate(currentPoints, numPoints(), resolvedParams, progress, time);
        break;
      case 'scale':
        applyScale(currentPoints, numPoints(), resolvedParams);
        break;
      case 'translate':
        applyTranslate(currentPoints, numPoints(), resolvedParams);
        break;
      case 'color':
        applyColor(currentPoints, numPoints(), resolvedParams, time);
        break;
      case 'wave':
        applyWave(currentPoints, numPoints(), resolvedParams, time);
        break;
      case 'blanking':
        applyBlanking(currentPoints, numPoints(), resolvedParams);
        break;
      case 'strobe':
        applyStrobe(currentPoints, numPoints(), resolvedParams, time);
        break;
      case 'mirror':
        currentPoints = applyMirror(currentPoints, numPoints(), resolvedParams);
        break;
      case 'warp':
        applyWarp(currentPoints, numPoints(), resolvedParams, time);
        break;
      case 'distortion':
        applyDistortion(currentPoints, numPoints(), resolvedParams, time);
        break;
      case 'move':
        applyMove(currentPoints, numPoints(), resolvedParams, time);
        break;
      case 'delay':
        if (effectStates && effect.instanceId) {
            currentPoints = applyDelay(currentPoints, numPoints(), resolvedParams, effectStates, effect.instanceId, context);
        }
        break;
      case 'chase':
        currentPoints = applyChase(currentPoints, numPoints(), resolvedParams, time, context);
        break;
      default:
        break;
    }
  }

  return { ...frame, points: currentPoints, isTypedArray: true };
}

function applyRotate(points, numPoints, params, progress, time) {
  const { angle, speed, direction } = withDefaults(params, effectDefinitions.find(def => def.id === 'rotate').defaultParams);
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
  const { blankingInterval, spacing = 0 } = withDefaults(params, effectDefinitions.find(def => def.id === 'blanking').defaultParams);
  if (blankingInterval <= 0) return;
  const step = blankingInterval + 1 + spacing;
  for (let i = 0; i < numPoints; i++) {
    if ((i % step) >= blankingInterval) {
        points[i * 8 + 6] = 1;
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
  if (mode === 'none') return points;
  let sourcePoints = [];
  for (let i = 0; i < numPoints; i++) {
      const offset = i * 8;
      const x = points[offset];
      const y = points[offset + 1];
      let keep = false;
      if (mode === 'x-') if (x <= 0) keep = true;
      else if (mode === 'x+') if (x >= 0) keep = true;
      else if (mode === 'y-') if (y <= 0) keep = true;
      else if (mode === 'y+') if (y >= 0) keep = true;
      if (keep) {
          sourcePoints.push({
              x: points[offset], y: points[offset+1], z: points[offset+2],
              r: points[offset+3], g: points[offset+4], b: points[offset+5],
              blk: points[offset+6], last: points[offset+7]
          });
      }
  }
  const newNumPoints = sourcePoints.length * 2;
  const newBuffer = new Float32Array(newNumPoints * 8);
  let ptr = 0;
  for (const p of sourcePoints) {
      newBuffer[ptr++] = p.x; newBuffer[ptr++] = p.y; newBuffer[ptr++] = p.z;
      newBuffer[ptr++] = p.r; newBuffer[ptr++] = p.g; newBuffer[ptr++] = p.b;
      newBuffer[ptr++] = p.blk; newBuffer[ptr++] = p.last;
  }
  for (const p of sourcePoints) {
      if (mode === 'x-' || mode === 'x+') newBuffer[ptr++] = -p.x; else newBuffer[ptr++] = p.x;
      if (mode === 'y-' || mode === 'y+') newBuffer[ptr++] = -p.y; else newBuffer[ptr++] = p.y;
      newBuffer[ptr++] = p.z; newBuffer[ptr++] = p.r; newBuffer[ptr++] = p.g; newBuffer[ptr++] = p.b;
      newBuffer[ptr++] = p.blk; newBuffer[ptr++] = p.last;
  }
  return newBuffer;
}

function applyWarp(points, numPoints, params, time) {
    const { amount, chaos, speed } = withDefaults(params, effectDefinitions.find(def => def.id === 'warp').defaultParams);
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
    const { mode = 'frame', delayAmount, decay, delayDirection, useCustomOrder, customOrder, playstyle = 'repeat' } = withDefaults(params, effectDefinitions.find(def => def.id === 'delay').defaultParams);
    if (!effectStates.has(instanceId)) effectStates.set(instanceId, []);
    const history = effectStates.get(instanceId);
    history.unshift(new Float32Array(points));

    if (mode === 'frame') {
        const steps = 10;
        const maxHistory = delayAmount * steps + 1;
        if (history.length > maxHistory) history.length = maxHistory;
        const newPoints = new Float32Array(points.length);
        for (let i = 0; i < numPoints; i++) {
            let step = 0;
            const norm = i / numPoints;
            if (delayDirection === 'left_to_right') step = Math.floor(norm * (steps - 1));
            else if (delayDirection === 'right_to_left') step = Math.floor((1 - norm) * (steps - 1));
            else if (delayDirection === 'center_to_out') step = Math.floor(Math.abs(norm - 0.5) * 2 * (steps - 1));
            else if (delayDirection === 'out_to_center') step = Math.floor((1 - Math.abs(norm - 0.5) * 2) * (steps - 1));
            const idx = step * delayAmount;
            const echo = (idx < history.length) ? history[idx] : null;
            const factor = Math.pow(decay, step);
            const off = i * 8;
            if (echo && echo.length === points.length) {
                newPoints[off] = echo[off]; newPoints[off+1] = echo[off+1]; newPoints[off+2] = echo[off+2];
                newPoints[off+3] = echo[off+3] * factor; newPoints[off+4] = echo[off+4] * factor; newPoints[off+5] = echo[off+5] * factor;
                newPoints[off+6] = echo[off+6]; newPoints[off+7] = echo[off+7];
            } else {
                newPoints.set(points.subarray(off, off+8), off);
                newPoints[off+3] = 0; newPoints[off+4] = 0; newPoints[off+5] = 0; newPoints[off+6] = 1;
            }
        }
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
    const { mode = 'frame', steps: paramSteps, decay, speed, overlap, direction, useCustomOrder, customOrder, playstyle = 'loop' } = withDefaults(params, effectDefinitions.find(def => def.id === 'chase').defaultParams);
    const { progress = 0, clipDuration = 1 } = context;
    const useSync = (progress !== undefined && clipDuration > 0);

    if (mode === 'frame') {
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
            newPoints[off+3] *= intensity; newPoints[off+4] *= intensity; newPoints[off+5] *= intensity;
            if (intensity < 0.05) newPoints[off+6] = 1;
        }
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

export function applyOutputProcessing(frame, settings) {
    if (!settings || !frame || !frame.points) return frame;
    const { safetyZones, outputArea, transformationEnabled, transformationMode, flipX, flipY } = settings;
    let points = frame.points;
    const isTyped = frame.isTypedArray || points instanceof Float32Array;
    const numPoints = isTyped ? (points.length / 8) : points.length;
    let newPoints = isTyped ? new Float32Array(points) : points.map(p => ({ ...p }));

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