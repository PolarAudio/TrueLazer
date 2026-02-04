import { applyEffects, applyOutputProcessing } from './effects.js';
import { effectDefinitions } from './effectDefinitions';
import { optimizePoints } from './optimizer.js';

export class WebGLRenderer {
  constructor(canvas, type) {
    this.canvas = canvas;
    this.type = type; // 'single' or 'world'
    this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    this.animationFrameId = null;
    this.frameIndexes = Array(10).fill(0); // Increased size and will handle dynamically
    this.pointIndexes = Array(10).fill(0); // Per-layer point indexes
    this.showBeamEffect = false; // Default value
    this.beamAlpha = 0.5; // Default value
    this.fadeAlpha = 0.13; // Default value
    this.beamRenderMode = 'both'; // Default value

    this.positionBuffer = null;
    this.colorBuffer = null;
    this.alphaBuffer = null;
    this.alphaBufferData = new Float32Array(131072); // Max points buffer for reuse

    this.lastPointDrawTime = 0; // Tracks the last time points were drawn

    if (!this.gl) {
      console.error("WebGL not supported");
      return;
    }

    this.setup();
  }

  setup() {
    const gl = this.gl;

    const vertexShaderSource = `
      attribute vec2 aPosition;
      attribute vec3 aColor;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        gl_PointSize = 2.0;
        vColor = aColor;
        vAlpha = aAlpha;
      }
    `;

    const fragmentShaderSource = `
      precision mediump float;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(vColor, vAlpha);
      }
    `;

    const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = this.createProgram(vertexShader, fragmentShader);

    this.program = program;
    this.positionAttributeLocation = gl.getAttribLocation(program, "aPosition");
    this.colorAttributeLocation = gl.getAttribLocation(program, "aColor");
    this.alphaAttributeLocation = gl.getAttribLocation(program, "aAlpha");

    // Setup for drawing a full-screen quad for fade effect
    this.quadPositionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadPositionBuffer);
    const positions = [
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    this.quadColorUniformLocation = gl.getUniformLocation(program, "uColor");
    this.quadAlphaUniformLocation = gl.getUniformLocation(program, "uAlpha");

    // Shader for drawing the fading quad
    const fadeVertexShaderSource = `
      attribute vec2 aPosition;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;

    const fadeFragmentShaderSource = `
      precision mediump float;
      uniform vec4 uColor;
      void main() {
        gl_FragColor = uColor;
      }
    `;

    const fadeVertexShader = this.createShader(gl.VERTEX_SHADER, fadeVertexShaderSource);
    const fadeFragmentShader = this.createShader(gl.FRAGMENT_SHADER, fadeFragmentShaderSource);
    this.fadeProgram = this.createProgram(fadeVertexShader, fadeFragmentShader);
    this.fadePositionAttributeLocation = gl.getAttribLocation(this.fadeProgram, "aPosition");
    this.fadeColorUniformLocation = gl.getUniformLocation(this.fadeProgram, "uColor");

    gl.useProgram(program);

    // Create and initialize buffers once
    const MAX_POINTS_PER_SEGMENT = 131072; // Max points in a single continuous segment

    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_POINTS_PER_SEGMENT * 2 * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW);

    this.colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_POINTS_PER_SEGMENT * 3 * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW);

    this.alphaBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.alphaBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_POINTS_PER_SEGMENT * 1 * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
  }

  reset() {
    this.frameIndexes.fill(0);
    this.pointIndexes.fill(0);
    this.clearCanvas();
  }

  createShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (success) {
      return shader;
    }

    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
  }

  createProgram(vertexShader, fragmentShader) {
    const gl = this.gl;
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    const success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (success) {
      return program;
    }

    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
  }

  render(data) {
    // Update internal beam effect settings from data
    if (data.showBeamEffect !== undefined) {
      this.setBeamEffect(data.showBeamEffect);
    }
    if (data.beamAlpha !== undefined) {
      this.setBeamAlpha(data.beamAlpha);
    }
    if (data.fadeAlpha !== undefined) {
      this.setFadeAlpha(data.fadeAlpha);
    }
    if (data.beamRenderMode !== undefined) {
      this.beamRenderMode = data.beamRenderMode;
    }

    if (this.type === 'world') {
      this.renderWorld(data.worldData, data.previewScanRate, data.layerIntensities, data.masterIntensity, data.dacSettings, data.previewTime, data.fftLevels, data.optimizationEnabled);
    }
    else {
      this.renderSingle(data.ildaFrames, data.previewScanRate, data.intensity, data.effects, data.syncSettings, data.bpm, data.clipDuration, data.progress, data.previewTime, data.fftLevels, data.effectStates, data.optimizationEnabled);
    }
  }

  renderSingle(ildaFrames, previewScanRate, intensity, effects, syncSettings = {}, bpm = 120, clipDuration = 1, progressOverride = null, previewTime = null, fftLevels = { low: 0, mid: 0, high: 0 }, effectStates = null, optimizationEnabled = true) {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    
    // Instead of full clear, draw a semi-transparent black quad for fade effect
    this.drawFadeQuad();

    if (!ildaFrames || ildaFrames.length === 0) {
      return;
    }

    const frameIndex = this.frameIndexes[0] % ildaFrames.length;
    const frame = ildaFrames[frameIndex];
    // Use override if provided (from App.jsx), otherwise calc local (always 0 for single frame)
    const progress = progressOverride !== null ? progressOverride : (frameIndex / ildaFrames.length);
    const time = previewTime !== null ? previewTime : performance.now();

    this.draw(frame, effects, this.showBeamEffect, this.beamAlpha, previewScanRate, this.beamRenderMode, intensity, 0, progress, time, syncSettings, bpm, clipDuration, fftLevels, effectStates, optimizationEnabled);

    this.frameIndexes[0]++;
    if (this.frameIndexes[0] >= ildaFrames.length) {
      this.frameIndexes[0] = 0;
    }
  }

  renderWorld(worldData, previewScanRate, layerIntensities, masterIntensity, dacSettings, previewTime = null, fftLevels = { low: 0, mid: 0, high: 0 }, optimizationEnabled = true) {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    
    // Instead of full clear, draw a semi-transparent black quad for fade effect
    this.drawFadeQuad();

    const time = previewTime !== null ? previewTime : performance.now();

    worldData.forEach((clip) => {
      if (clip && clip.frames && clip.frames.length > 0) {
        const frame = clip.frames[0]; // Get the first and only frame
        if (frame) {
            const layerIndex = clip.layerIndex || 0;
            const syncSettings = clip.syncSettings || {};
            const bpm = clip.bpm || 120; // Assuming clip object might carry bpm or use global if passed
            // Ensure arrays are large enough
            if (layerIndex >= this.frameIndexes.length) {
                const newSize = layerIndex + 5;
                while(this.frameIndexes.length < newSize) {
                    this.frameIndexes.push(0);
                    this.pointIndexes.push(0);
                }
            }

            const layerIntensity = layerIntensities[layerIndex] !== undefined ? layerIntensities[layerIndex] : 1;
            const finalIntensity = layerIntensity * masterIntensity;
            
            // Skip rendering if intensity is effectively zero
            if (finalIntensity > 0.001) {
                const progress = clip.progress !== undefined ? clip.progress : (this.frameIndexes[layerIndex] % clip.frames.length) / clip.frames.length;
                const { syncSettings = {}, bpm = 120, clipDuration = 1, effectStates = null } = clip;
                
                // If dacSettings provided, we apply them.
                // In exact copy mode, we might want to apply settings after merge, but here we apply per layer for simplicity if we don't want to refactor the draw loop.
                // Actually, DAC settings (scaling/zoning) apply to the final output.
                
                let frameToDraw = frame;
                if (dacSettings) {
                    // Apply Dimmer if present in settings
                    let processedFrame = frame;
                    if (dacSettings.dimmer !== undefined && dacSettings.dimmer < 1) {
                         const pts = frame.points;
                         const isT = frame.isTypedArray || pts instanceof Float32Array;
                         const n = isT ? (pts.length / 8) : pts.length;
                         const newPts = isT ? new Float32Array(pts) : pts.map(p => ({...p}));
                         for(let i=0; i<n; i++) {
                             if (isT) {
                                 newPts[i*8+3] *= dacSettings.dimmer;
                                 newPts[i*8+4] *= dacSettings.dimmer;
                                 newPts[i*8+5] *= dacSettings.dimmer;
                             } else {
                                 newPts[i].r *= dacSettings.dimmer;
                                 newPts[i].g *= dacSettings.dimmer;
                                 newPts[i].b *= dacSettings.dimmer;
                             }
                         }
                         processedFrame = { ...frame, points: newPts, isTypedArray: t };
                    }
                    frameToDraw = applyOutputProcessing(processedFrame, dacSettings);
                }

                // Pass layerIndex, progress and time to draw
                this.draw(frameToDraw, clip.effects, this.showBeamEffect, this.beamAlpha, previewScanRate, this.beamRenderMode, finalIntensity, layerIndex, progress, time, syncSettings, bpm, clipDuration, fftLevels, effectStates, optimizationEnabled);
            }
        }
      }
    });

    worldData.forEach((clip) => {
      if (clip && clip.frames) {
        const layerIndex = clip.layerIndex || 0;
        this.frameIndexes[layerIndex]++;
        if (this.frameIndexes[layerIndex] >= clip.frames.length) {
          this.frameIndexes[layerIndex] = 0;
        }
      }
    });
  }

  drawFadeQuad() {
    const gl = this.gl;
    if (!this.fadeProgram) return;

    gl.useProgram(this.fadeProgram);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadPositionBuffer);
    gl.enableVertexAttribArray(this.fadePositionAttributeLocation);
    gl.vertexAttribPointer(this.fadePositionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    // Set fade color (black with alpha based on fadeAlpha)
    gl.uniform4f(this.fadeColorUniformLocation, 0, 0, 0, this.fadeAlpha);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  setBeamEffect(enabled) {
    this.showBeamEffect = enabled;
  }

  setBeamAlpha(alpha) {
    this.beamAlpha = alpha;
  }

  setFadeAlpha(alpha) {
    this.fadeAlpha = alpha;
  }

  draw(frame, effects, showBeamEffect, beamAlpha, previewScanRate, beamRenderMode, intensity = 1, layerIndex = 0, progress = 0, time = performance.now(), syncSettings = {}, bpm = 120, clipDuration = 1, fftLevels = { low: 0, mid: 0, high: 0 }, effectStates = null, optimizationEnabled = true) {
    const gl = this.gl;
    if (!frame || !frame.points) return;

    // Apply sync overrides to effects for the preview
    // Note: applyEffects now handles parameter resolution internally if syncSettings is passed in context.
    // However, we also have logic here that manually modifies params before calling applyEffects.
    // Ideally, we should unify this. 
    // `applyEffects` has been updated to use `resolveParam` internally if `syncSettings` is in context.
    // So we can simplify this and just pass `syncSettings` and `bpm` in context.
    
    // BUT, the existing manual mapping here (lines 323-338 in original) handles only range/number types
    // and calculates `newParams`.
    // If we remove it, we rely entirely on `applyEffects`.
    // Let's rely on 'applyEffects' which we just updated to be robust.
    // So we pass original 'effects' and let 'applyEffects' do the work.
    
    // Optimize BEFORE effects (Option 3 match)
    let frameToProcess = frame;
    if (optimizationEnabled) {
        const optimizedPoints = optimizePoints(frame.points);
        frameToProcess = { ...frame, points: optimizedPoints, isTypedArray: true };
    }

    // Apply effects before drawing
    // We pass syncSettings and bpm in the context
    const modifiedFrame = applyEffects(frameToProcess, effects, { progress, time, syncSettings, bpm, clipDuration, fftLevels, effectStates });
    const points = modifiedFrame.points;
    const isTyped = modifiedFrame.isTypedArray;
    const numPoints = isTyped ? (points.length / 8) : points.length;
    
    if (numPoints === 0) return;

    const pointsToDraw = Math.max(1, Math.floor(numPoints / previewScanRate));
    let startIndex = this.pointIndexes[layerIndex] || 0;
    if (startIndex >= numPoints) startIndex = 0;

    // Helper to get point data
    const getPointData = (idx) => {
        const i = (startIndex + idx) % numPoints;
        if (isTyped) {
            const offset = i * 8;
            return {
                x: points[offset],
                y: points[offset + 1],
                r: points[offset + 3],
                g: points[offset + 4],
                b: points[offset + 5],
                blanking: points[offset + 6] === 1
            };
        } else {
            const p = points[i];
            return {
                x: p.x,
                y: p.y,
                r: p.r,
                g: p.g,
                b: p.b,
                blanking: p.blanking
            };
        }
    };

    // --- Helper function to draw normal frame segments ---
    const drawNormalFrame = () => {
      // Modes: 'points' (dots), 'lines' (strip), 'both' (strip + dots)
      const drawPoints = beamRenderMode === 'points' || beamRenderMode === 'both';
      const drawLines = beamRenderMode === 'lines' || beamRenderMode === 'both';
      
      let currentSegmentPositions = [];
      let currentSegmentColors = [];
      
      for (let i = 0; i < pointsToDraw; i++) {
        const point = getPointData(i);
        if (point.blanking) {
          if (currentSegmentPositions.length > 0) {
            if (drawLines) this._drawSegment(new Float32Array(currentSegmentPositions), new Float32Array(currentSegmentColors), 1.0, currentSegmentPositions.length / 2, false);
            if (drawPoints) this._drawSegment(new Float32Array(currentSegmentPositions), new Float32Array(currentSegmentColors), 1.0, currentSegmentPositions.length / 2, true);
            currentSegmentPositions = [];
            currentSegmentColors = [];
          }
          continue;
        }
        currentSegmentPositions.push(point.x, point.y);
        currentSegmentColors.push(point.r / 255 * intensity, point.g / 255 * intensity, point.b / 255 * intensity);
      }
      if (currentSegmentPositions.length > 0) {
        if (drawLines) this._drawSegment(new Float32Array(currentSegmentPositions), new Float32Array(currentSegmentColors), 1.0, currentSegmentPositions.length / 2, false);
        if (drawPoints) this._drawSegment(new Float32Array(currentSegmentPositions), new Float32Array(currentSegmentColors), 1.0, currentSegmentPositions.length / 2, true);
      }
    };

    // --- Helper function for 'points' mode (center-to-point beams) ---
    const drawPointsEffect = () => {
      const beamPositions = [];
      const beamColors = [];
      for (let i = 0; i < pointsToDraw; i++) {
        const point = getPointData(i);
        if (!point.blanking) {
          beamPositions.push(0, 0, point.x, point.y);
          const color = [point.r / 255 * intensity, point.g / 255 * intensity, point.b / 255 * intensity];
          beamColors.push(...color, ...color);
        }
      }
      if (beamPositions.length > 0) {
        this._drawLines(new Float32Array(beamPositions), new Float32Array(beamColors), beamAlpha, beamPositions.length / 2);
      }
    };
    
    // --- Helper function for 'lines' mode (volumetric cone) ---
    const drawLinesEffect = () => {
      const trianglePositions = [];
      const triangleColors = [];
      let prevPoint = getPointData(0);

      for (let i = 1; i < pointsToDraw; i++) {
        const point = getPointData(i);
        if (!prevPoint.blanking && !point.blanking) {
          trianglePositions.push(0, 0, prevPoint.x, prevPoint.y, point.x, point.y);
          
          const color1 = [prevPoint.r / 255 * intensity, prevPoint.g / 255 * intensity, prevPoint.b / 255 * intensity];
          const color2 = [point.r / 255 * intensity, point.g / 255 * intensity, point.b / 255 * intensity];
          
          // Center is average of full intensity colors
          const centerColor = [(color1[0] + color2[0]) / 2, (color1[1] + color2[1]) / 2, (color1[2] + color2[2]) / 2];
          
          // Fade edges to simulate density drop-off (Halo effect)
          const edgeFade = 0.3;
          const fadedColor1 = [color1[0] * edgeFade, color1[1] * edgeFade, color1[2] * edgeFade];
          const fadedColor2 = [color2[0] * edgeFade, color2[1] * edgeFade, color2[2] * edgeFade];

          triangleColors.push(...centerColor, ...fadedColor1, ...fadedColor2);
        }
        prevPoint = point;
      }
      if (trianglePositions.length > 0) {
        this._drawTriangles(new Float32Array(trianglePositions), new Float32Array(triangleColors), beamAlpha, trianglePositions.length / 2);
      }
    };

    // --- Main rendering logic ---
    drawNormalFrame();

    if (showBeamEffect) {
      if (beamRenderMode === 'points') {
        drawPointsEffect();
      } else if (beamRenderMode === 'lines') {
        drawLinesEffect();
      } else if (beamRenderMode === 'both') {
        drawLinesEffect();
        drawPointsEffect();
      }
    }

    this.pointIndexes[layerIndex] = (startIndex + pointsToDraw) % numPoints;
  }

  _drawSegment(positions, colors, alpha, numPoints, usePoints = false) {
    const gl = this.gl;

    gl.useProgram(this.program);

    // Positions
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.enableVertexAttribArray(this.positionAttributeLocation);
    gl.vertexAttribPointer(this.positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    // Colors
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors);
    gl.enableVertexAttribArray(this.colorAttributeLocation);
    gl.vertexAttribPointer(this.colorAttributeLocation, 3, gl.FLOAT, false, 0, 0);

    // Alpha
    if (this.alphaBufferData.length < numPoints) {
        this.alphaBufferData = new Float32Array(numPoints * 2);
    }
    this.alphaBufferData.fill(alpha, 0, numPoints);
    const alphas = this.alphaBufferData.subarray(0, numPoints);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.alphaBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, alphas);
    gl.enableVertexAttribArray(this.alphaAttributeLocation);
    gl.vertexAttribPointer(this.alphaAttributeLocation, 1, gl.FLOAT, false, 0, 0);

    gl.drawArrays(usePoints ? gl.POINTS : gl.LINE_STRIP, 0, numPoints);
  }

  _drawLines(positions, colors, alpha, numPoints) {
    const gl = this.gl;

    gl.useProgram(this.program);

    // Positions
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.enableVertexAttribArray(this.positionAttributeLocation);
    gl.vertexAttribPointer(this.positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    // Colors
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors);
    gl.enableVertexAttribArray(this.colorAttributeLocation);
    gl.vertexAttribPointer(this.colorAttributeLocation, 3, gl.FLOAT, false, 0, 0);

    // Alpha
    if (this.alphaBufferData.length < numPoints) {
        this.alphaBufferData = new Float32Array(numPoints * 2);
    }
    this.alphaBufferData.fill(alpha, 0, numPoints);
    const alphas = this.alphaBufferData.subarray(0, numPoints);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.alphaBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, alphas);
    gl.enableVertexAttribArray(this.alphaAttributeLocation);
    gl.vertexAttribPointer(this.alphaAttributeLocation, 1, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.LINES, 0, numPoints);
  }

  _drawTriangles(positions, colors, alpha, numPoints) {
    const gl = this.gl;

    gl.useProgram(this.program);

    // Positions
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.enableVertexAttribArray(this.positionAttributeLocation);
    gl.vertexAttribPointer(this.positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    // Colors
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors);
    gl.enableVertexAttribArray(this.colorAttributeLocation);
    gl.vertexAttribPointer(this.colorAttributeLocation, 3, gl.FLOAT, false, 0, 0);

    // Alpha
    if (this.alphaBufferData.length < numPoints) {
        this.alphaBufferData = new Float32Array(numPoints * 2);
    }
    this.alphaBufferData.fill(alpha, 0, numPoints);
    const alphas = this.alphaBufferData.subarray(0, numPoints);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.alphaBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, alphas);
    gl.enableVertexAttribArray(this.alphaAttributeLocation);
    gl.vertexAttribPointer(this.alphaAttributeLocation, 1, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, numPoints);
  }

  

  clearCanvas() {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  destroy() {
    cancelAnimationFrame(this.animationFrameId);
    if (this.gl) {
        const ext = this.gl.getExtension('WEBGL_losing_context');
        if (ext) ext.loseContext();
    }
  }
}