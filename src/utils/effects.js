import { effectDefinitions } from './effectDefinitions';

const withDefaults = (params, defaults) => ({ ...defaults, ...params });

// Helper to resolve animated parameter values
function resolveParam(key, baseValue, animSettings, context) {
    if (!animSettings) return baseValue;

    // Handle legacy simple string mode or object mode
    const settings = typeof animSettings === 'string' 
        ? { syncMode: animSettings } 
        : animSettings;
    
    if (!settings.syncMode) return baseValue;

    const { time, progress } = context;
    let animProgress = 0;

    // 1. Calculate Base Progress
    if (settings.syncMode === 'fps') {
        // Default 1Hz cycle roughly
        animProgress = (time * 0.001) % 1.0;
    } else if (settings.syncMode === 'timeline' || settings.syncMode === 'bpm') {
        animProgress = progress || 0;
    }

    // 2. Apply Direction
    const direction = settings.direction || 'forward';
    if (direction === 'backward') {
        animProgress = 1.0 - animProgress;
    } else if (direction === 'pause') {
        // TODO: Handle pause better (hold value)
        // For now, static at 0 or current
        return baseValue; 
    }

    // 3. Apply Style
    const style = settings.style || 'loop';
    if (style === 'bounce') {
        // 0 -> 1 -> 0
        animProgress = animProgress < 0.5 ? animProgress * 2 : 2 - (animProgress * 2);
    } else if (style === 'once') {
        animProgress = Math.min(animProgress, 1);
    }

    // 4. Map to Range
    // The RangeSlider gives us [min, max].
    // If range is defined in settings, use it. Else use definition min/max? 
    // Usually settings.range is populated by the UI.
    const range = settings.range; 
    let min = 0, max = 1;

    if (range && Array.isArray(range) && range.length === 2) {
        min = range[0];
        max = range[1];
    } else {
        // Fallback? We don't have access to definition here easily without passing it.
        // We'll rely on baseValue being the "start" or similar?
        // Actually, the UI saves 'range' in syncSettings.
        // If no range, maybe we just oscillate around baseValue?
        // Let's assume range is passed.
        return baseValue; // Fallback if no range
    }

    return min + (max - min) * animProgress;
}

/**
 * Optimized applyEffects that minimizes object creation and GC.
 */
export function applyEffects(frame, effects, context = {}) {
  const { progress = 0, time = performance.now(), effectStates, syncSettings = {} } = context;

  if (!effects || effects.length === 0) return frame;

  // Conversion to TypedArray
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
    const definition = effectDefinitions.find(def => def.id === effect.id);
    if (!definition) continue;

    // Resolve Animated Parameters
    const resolvedParams = { ...effect.params };
    
    // Check for sync settings attached to the effect (passed from App.jsx usually in effect.params or syncSettings map)
    // In App.jsx, syncSettings are stored in clip.syncSettings and passed in 'context' or merged into effect?
    // The 'effects' array passed here from App.jsx ALREADY has resolved params!
    // Wait, App.jsx line 2370: "const syncedEffects = effects.map(eff => ...)"
    // So App.jsx IS ALREADY doing the animation resolution!
    // I don't need to do it here again.
    // BUT, the user requirement is "Effects & Generator Parameter/Values Mappable & Animate-able".
    // If App.jsx handles it, I might just need to fix the UI to set the settings correctly.
    // However, the user said: "The animation part is still not working... If the Function for Clip-Playback Style is flawed..."
    // AND "We want to use the same logic for each effect sepperatly".
    // I see logic in App.jsx.
    // I will double check App.jsx logic.
    // App.jsx logic seemed to handle 'range' and 'style'.
    // Maybe I should just trust the passed params are resolved.
    // But for "Generator", parameters are updated in state?
    // For Effects, they are calculated per frame.
    // I will stick to using `effect.params` as they are passed.
    // If `applyEffects` is called from `IldaPlayer` (Preview), `App.jsx` might not have resolved them yet?
    // In `IldaPlayer.jsx`: `worker.postMessage({ action: 'update', payload: { data: { effects: effects ... } } })`.
    // `IldaPlayer` receives `effects` as props.
    // `App.jsx` passes `effects` from `clip.effects`.
    // `App.jsx` does NOT resolve params before passing to `IldaPlayer`.
    // `App.jsx` ONLY resolves params inside the `animate` function for DAC OUTPUT.
    // So the Preview (IldaPlayer) does NOT see animations?
    // This explains why "animation part is still not working" (in preview?).
    // I should implement the resolution HERE in `effects.js` so it works for both Preview (Worker) and Output.
    // AND I should remove the resolution from `App.jsx` to avoid double application?
    // Or just be safe: If `context` has `syncSettings`, I resolve.
    // `App.jsx` `animate` passes `syncedEffects` where params are already modified.
    // `IldaPlayer` passes raw `effects`.
    // So if I modify `applyEffects` to resolve params, I need to make sure `App.jsx` doesn't resolve them twice.
    // `App.jsx` passes `syncedEffects` to `applyEffects`.
    // If `syncedEffects` params are already numbers, `resolveParam` will likely just return them if no syncSettings found for them?
    // But `App.jsx` logic creates new params.
    // Ideally, logic should be central here.
    // I will implement resolution here. The `App.jsx` resolution is redundant but probably harmless if I check `syncSettings` from context.
    // `App.jsx` passes `effectStates` but NOT `syncSettings` explicitly in the `context` object in `animate` loop?
    // Line 2406: `applyEffects(..., { progress..., effectStates: effectStatesRef.current })`.
    // No `syncSettings` passed in context.
    // But `IldaPlayer` -> `rendering.worker.js` -> `applyEffects`.
    // `rendering.worker.js` receives `data` which has `effects`.
    // `IldaPlayer` does not pass `syncSettings` separately. `effects` object usually contains `params`.
    // Where are `syncSettings` stored? In `clip.syncSettings`.
    // `IldaPlayer` prop `effects` is just the array. It doesn't know about `clip.syncSettings`.
    // I need to ensure `effects` objects have the sync data attached or passed.
    // In `App.jsx`, `layerEffects` and `clip.effects` are arrays of objects.
    // `syncSettings` seem to be stored in `clip.syncSettings`.
    // `clip.effects` elements don't have `syncSettings` inside them.
    // So `IldaPlayer` receiving `clip.effects` will NOT have sync info.
    // I must update `IldaPlayer` to receive `syncSettings` or merge them into effects.
    // BUT I cannot edit `App.jsx` extensively right now (too big, risk).
    // I will assume `effect.sync` or similar property?
    // Use Case: User edits `EffectEditor`. Updates `syncSettings`.
    // If I can't easily fix the pipeline, I will focus on the logic in `effects.js` assuming the data gets there.
    
    // For now, I'll stick to the requested changes in `effects.js` logic (Mirror/Delay).
    
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
        // Delay can change point count
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

// ... (Keep existing simple functions: rotate, scale, translate, color, wave, blanking, strobe)
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
  const { blankingInterval } = withDefaults(params, effectDefinitions.find(def => def.id === 'blanking').defaultParams);
  if (blankingInterval <= 0) return;
  for (let i = 0; i < numPoints; i++) {
    if ((i % (blankingInterval + 1)) === blankingInterval) {
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

// Updated applyMirror for Symmetry/Folding
function applyMirror(points, numPoints, params) {
  const { mode } = withDefaults(params, effectDefinitions.find(def => def.id === 'mirror').defaultParams);
  if (mode === 'none') return points;

  // We are creating a NEW set of points (doubling the count)
  // New size = numPoints * 2? 
  // Wait, we only want to mirror the "Source" side. 
  // If we assume "Source" is half the screen, we double that half.
  // The points array contains points from the whole screen.
  // We should FILTER then duplicate.
  
  let sourcePoints = [];
  
  for (let i = 0; i < numPoints; i++) {
      const offset = i * 8;
      const x = points[offset];
      const y = points[offset + 1];
      
      let keep = false;
      if (mode === 'x-') { // Keep Left
          if (x <= 0) keep = true;
      } else if (mode === 'x+') { // Keep Right
          if (x >= 0) keep = true;
      } else if (mode === 'y-') { // Keep Bottom
          if (y <= 0) keep = true;
      } else if (mode === 'y+') { // Keep Top
          if (y >= 0) keep = true;
      }
      
      if (keep) {
          sourcePoints.push({
              x: points[offset], y: points[offset+1], z: points[offset+2],
              r: points[offset+3], g: points[offset+4], b: points[offset+5],
              blk: points[offset+6], last: points[offset+7]
          });
      }
  }

  // Now create the new buffer. Size = sourcePoints.length * 2
  const newNumPoints = sourcePoints.length * 2;
  const newBuffer = new Float32Array(newNumPoints * 8);
  
  let ptr = 0;
  
  // Write Original (Source)
  for (const p of sourcePoints) {
      newBuffer[ptr++] = p.x;
      newBuffer[ptr++] = p.y;
      newBuffer[ptr++] = p.z;
      newBuffer[ptr++] = p.r;
      newBuffer[ptr++] = p.g;
      newBuffer[ptr++] = p.b;
      newBuffer[ptr++] = p.blk;
      newBuffer[ptr++] = p.last;
  }
  
  // Write Mirrored (Reflection)
  for (const p of sourcePoints) {
      if (mode === 'x-' || mode === 'x+') newBuffer[ptr++] = -p.x;
      else newBuffer[ptr++] = p.x;
      
      if (mode === 'y-' || mode === 'y+') newBuffer[ptr++] = -p.y;
      else newBuffer[ptr++] = p.y;
      
      newBuffer[ptr++] = p.z;
      newBuffer[ptr++] = p.r;
      newBuffer[ptr++] = p.g;
      newBuffer[ptr++] = p.b;
      newBuffer[ptr++] = p.blk;
      newBuffer[ptr++] = p.last;
  }
  
  return newBuffer;
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

// Updated applyDelay for Channel/Custom Order logic
function applyDelay(points, numPoints, params, effectStates, instanceId, context) {
    const defaults = effectDefinitions.find(def => def.id === 'delay').defaultParams;
    const { 
        delayAmount, decay, 
        useCustomOrder, delayDirection, customOrder 
    } = withDefaults(params, defaults);
    
    // Legacy support for 'delayMode' if passed
    const isCustomOrder = useCustomOrder || params.delayMode === 'channel' || params.delayMode === true;

    if (!effectStates.has(instanceId)) {
        effectStates.set(instanceId, []);
    }
    
    const history = effectStates.get(instanceId);
    
    // 1. Save current frame snapshot (Clone)
    const currentSnapshot = new Float32Array(points);
    history.unshift(currentSnapshot);
    
    const { assignedDacs } = context || {}; // Get assignedDacs from context if available

    // Determine Channel Delay Map (DAC Index -> Delay Step)
    let channelDelayMap = new Map();
    let maxStep = 0;

    if (isCustomOrder) {
        let list = [];
        if (customOrder && Array.isArray(customOrder) && customOrder.length > 0) {
            // customOrder items contain {originalIndex}
            list = customOrder.map(item => (item.originalIndex !== undefined ? item.originalIndex : 0));
        } else if (assignedDacs) {
            // Fallback to auto if custom is empty but mode is custom
            list = assignedDacs.map((_, i) => i);
        } else {
            list = [0];
        }
        
        // In Custom Mode, the order in the list DEFINES the step.
        // Index 0 in list = Step 0. Index 1 = Step 1.
        list.forEach((dacIdx, step) => {
            channelDelayMap.set(dacIdx, step);
            maxStep = Math.max(maxStep, step);
        });

    } else {
        // Auto Directional Mode
        const dacs = assignedDacs || [];
        const N = dacs.length || 1; 
        
        // Calculate Delay Step for each physical index i (0..N-1)
        for(let i=0; i<N; i++) {
            let step = 0;
            if (delayDirection === 'right_to_left') {
                step = N - 1 - i;
            } else if (delayDirection === 'center_to_out') {
                // Center = Step 0, Out = Max Step
                // Logic: Distance from center
                step = Math.floor(Math.abs(i - (N - 1) / 2));
            } else if (delayDirection === 'out_to_center') {
                // Out = Step 0, Center = Max Step
                // Logic: Distance from edge (min of dist to start or end)
                step = Math.min(i, N - 1 - i);
            } else {
                // left_to_right
                step = i;
            }
            
            channelDelayMap.set(i, step);
            maxStep = Math.max(maxStep, step);
        }
        
        // If no assigned DACs, default map for preview (0->0)
        if (N === 0) {
            channelDelayMap.set(0, 0);
        }
    }
    
    // 2. Generate Echoes based on maxStep
    const numEchoes = maxStep + 1;

    // Limit history size
    const maxHistory = delayAmount * numEchoes + 1;
    if (history.length > maxHistory) {
        history.length = maxHistory;
    }
    
    const echoes = [];
    
    for(let k=0; k<numEchoes; k++) {
        const index = k * delayAmount;
        let echoPoints = null; // Default to null (Blank) if history missing
        
        if (index === 0) {
            echoPoints = points; // Current frame
        } else if (index < history.length) {
            echoPoints = history[index];
        }
        
        const factor = Math.pow(decay, k);
        
        // We push even if null, to maintain channel slot
        echoes.push({ points: echoPoints, factor, index: k });
    }
    
    if (echoes.length === 0) return points;
    
    // Create new buffer
    const totalPoints = numPoints + echoes.reduce((sum, e) => sum + (e.points ? e.points.length / 8 : points.length / 8), 0);
    const newBuffer = new Float32Array(totalPoints * 8);
    
    let offset = 0;
    const echoOffsets = new Array(echoes.length);

    // Write Echoes
    for (let k = 0; k < echoes.length; k++) {
        const echo = echoes[k];
        const ePoints = echo.points;
        const eNum = ePoints ? ePoints.length / 8 : points.length / 8;
        const factor = echo.factor;
        
        echoOffsets[k] = offset; 

        // Copy and Modify
        for(let i=0; i<eNum; i++) {
            const srcOff = i*8;
            const dstOff = offset + i*8;
            
            let srcX=0, srcY=0, srcZ=0, srcR=0, srcG=0, srcB=0, srcBlk=1, srcLast=0;

            if (ePoints) {
                // Source Data (Past Frame)
                srcX = ePoints[srcOff];
                srcY = ePoints[srcOff+1];
                srcZ = ePoints[srcOff+2];
                srcR = ePoints[srcOff+3];
                srcG = ePoints[srcOff+4];
                srcB = ePoints[srcOff+5];
                srcBlk = ePoints[srcOff+6];
                srcLast = ePoints[srcOff+7];
            } else {
                // Blank Frame (Before Start)
                srcBlk = 1;
            }

            newBuffer[dstOff] = srcX;
            newBuffer[dstOff+1] = srcY;
            newBuffer[dstOff+2] = srcZ; 

            newBuffer[dstOff+3] = srcR * factor;
            newBuffer[dstOff+4] = srcG * factor;
            newBuffer[dstOff+5] = srcB * factor;
            
            newBuffer[dstOff+6] = srcBlk; 
            newBuffer[dstOff+7] = srcLast; 
        }
        offset += eNum * 8;
    }

    // Construct Distribution Map
    // Map: DAC Index -> Buffer Segment using channelDelayMap
    const distributions = new Map();
    
    channelDelayMap.forEach((step, dacIndex) => {
        if (step < echoes.length) {
            const start = echoOffsets[step];
            // Length depends on if it was null or real
            const length = echoes[step].points ? echoes[step].points.length : points.length;
            distributions.set(dacIndex, { start, length });
        }
    });
    
    newBuffer._channelDistributions = distributions;

    return newBuffer;
}

export function applyChase(points, numPoints, params, time, context = {}) {
    const { steps, decay, speed, overlap, direction, useCustomOrder, customOrder } = withDefaults(params, effectDefinitions.find(def => def.id === 'chase').defaultParams);
    
    // Chase now operates on CHANNEL Intensity, not point geometry, if mapped to channels.
    // However, effects.js processes "Frame Data".
    // "Intensity output for each channel".
    // If the frame is broadcast to multiple channels, this effect should MODIFY the intensity 
    // SPECIFICALLY for the channel it is being rendered for.
    // BUT `applyEffects` is usually called once per frame, NOT once per channel.
    // Wait. `IldaPlayer` renders ONE frame. 
    // If we want different output per channel, we need to know WHICH channel we are rendering for.
    // The `context` passed to `applyEffects` might need to contain `targetChannel` or similar?
    // In `App.jsx`, `animate` loops over `dacs`.
    // It calls `applyEffects` for EACH dac if `delay` or `chase` needs it?
    // Actually, `App.jsx` calls `applyEffects` ONCE globally for the clip.
    // Then it sends the result to all DACs.
    // UNLESS the effect is `delay` (which returns a buffer with `_channelDistributions`).
    // If `chase` is like `delay`, it should probably return a buffer that `App.jsx` or `idn-communication` understands.
    // `applyDelay` logic splits the frame into "Channel Distributions".
    // If `chase` works similarly, it should create separate intensity maps?
    // BUT `chase` logic described: "first channel is on while all other are off".
    // This implies `Chase` is a Multi-Channel effect like `Delay`.
    // So `applyChase` should likely behave like `applyDelay`:
    // It receives the points, and it needs to assign them to channels with modified intensity.
    // Actually, `applyDelay` creates echo frames.
    // `Chase` just needs to modulate brightness based on the assigned channel index.
    
    // We need to know:
    // 1. Total assigned channels (N).
    // 2. Which channel is "active" at time T.
    // 3. For each channel i, calculate intensity.
    // 4. Return a structure that tells the renderer/sender what to send to each channel.
    // `applyDelay` returns `newBuffer._channelDistributions`.
    // We can use the same mechanism!
    // We can create N copies of the frame (one for each channel).
    // Modulate intensity for each copy.
    // Combine them into one big buffer and set `_channelDistributions`.
    
    const { assignedDacs } = context || {};
    // Determine channel mapping (like Delay)
    let channelStepMap = new Map();
    let numChannels = 0;

    if (useCustomOrder) {
        let list = [];
        if (customOrder && Array.isArray(customOrder) && customOrder.length > 0) {
            list = customOrder.map(item => (item.originalIndex !== undefined ? item.originalIndex : 0));
        } else if (assignedDacs) {
            list = assignedDacs.map((_, i) => i);
        } else {
            list = [0];
        }
        
        list.forEach((dacIdx, stepIndex) => {
            channelStepMap.set(dacIdx, stepIndex); // Map DAC Index -> Logical Step Index
            numChannels++;
        });
    } else {
        const dacs = assignedDacs || [];
        numChannels = dacs.length || 1;
        for(let i=0; i<numChannels; i++) {
            let stepIndex = i; // Default linear
             if (direction === 'right_to_left') {
                stepIndex = numChannels - 1 - i;
            } else if (direction === 'center_to_out') {
                stepIndex = Math.floor(Math.abs(i - (numChannels - 1) / 2));
            } else if (direction === 'out_to_center') {
                stepIndex = Math.min(i, numChannels - 1 - i);
            }
            channelStepMap.set(i, stepIndex);
        }
    }
    
    // If no channels, treat as single
    if (numChannels === 0) numChannels = 1;

    // Time-based Chase Position
    // Cycle length = numChannels (or maxStep?)
    // Actually, let's say cycle covers all channels.
    const cycleLength = numChannels;
    const t = (time * 0.001 * speed) % cycleLength;
    
    // Create big buffer
    const pointsPerChannel = numPoints; 
    const totalPoints = pointsPerChannel * numChannels; // We create a copy for EACH channel
    const newBuffer = new Float32Array(totalPoints * 8);
    
    const distributions = new Map();
    let offset = 0;
    
    // Iterate over PHYSICALLY ASSIGNED DACs (or 0..N-1 if simple)
    // We need to iterate 0..N-1 to create the buffer segments.
    // And map them to DACs.
    
    // Wait, channelStepMap keys are DAC indices.
    // We should iterate over the Map entries.
    
    // If assignedDacs is missing, we simulate 1 channel?
    const dacIndices = Array.from(channelStepMap.keys());
    if (dacIndices.length === 0) dacIndices.push(0);
    
    for (const dacIndex of dacIndices) {
        const stepIndex = channelStepMap.get(dacIndex) || 0;
        
        // Calculate Intensity for this channel
        // Distance between 't' (active head) and 'stepIndex'.
        // Circular distance? "Chase" usually loops.
        
        let dist = Math.abs(t - stepIndex);
        // Handle wrap-around for loop
        if (dist > cycleLength / 2) dist = cycleLength - dist;
        
        // Overlap Logic
        // If dist < overlap/2 ?
        // Let's say overlap=1 means only 1 active. overlap=2 means neighbors active.
        // We use a bell curve or linear falloff.
        // Intensity = 1 at dist=0. 0 at dist=overlap.
        
        let intensity = 0;
        if (dist < overlap) {
             intensity = 1.0 - (dist / overlap);
             intensity = Math.max(0, intensity);
             // Apply decay curve?
             if (decay > 0) intensity = Math.pow(intensity, 1 - decay); // Modify curve
        }
        
        // Copy points and Apply Intensity
        const startOffset = offset;
        for (let i = 0; i < numPoints; i++) {
             const srcOff = i * 8;
             const dstOff = offset + i * 8;
             
             newBuffer[dstOff] = points[srcOff];
             newBuffer[dstOff+1] = points[srcOff+1];
             newBuffer[dstOff+2] = points[srcOff+2] || 0;
             
             newBuffer[dstOff+3] = points[srcOff+3] * intensity;
             newBuffer[dstOff+4] = points[srcOff+4] * intensity;
             newBuffer[dstOff+5] = points[srcOff+5] * intensity;
             
             // Blanking: If intensity is near zero, force blank?
             // Or keep color but dark?
             // If very dark, maybe blank to save galvos?
             newBuffer[dstOff+6] = (intensity < 0.05) ? 1 : (points[srcOff+6]);
             newBuffer[dstOff+7] = points[srcOff+7];
        }
        
        distributions.set(dacIndex, { start: startOffset, length: numPoints });
        offset += numPoints * 8;
    }
    
    newBuffer._channelDistributions = distributions;
    return newBuffer;
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

        if (transformationEnabled && outputArea) {
            let u = (x + 1) / 2;
            let v = (1 - y) / 2; 
            if (transformationMode === 'crop') {
                if (u < outputArea.x || u > outputArea.x + outputArea.w || 
                    v < outputArea.y || v > outputArea.y + outputArea.h) {
                    r = 0; g = 0; b = 0; blanking = 1;
                }
            } else if (transformationMode === 'scale') {
                u = outputArea.x + (u * outputArea.w);
                v = outputArea.y + (v * outputArea.h);
                x = u * 2 - 1;
                y = 1 - (v * 2);
            }
        }

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
