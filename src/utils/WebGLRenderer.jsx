export class WebGLRenderer {
  constructor(canvas, type) {
    this.canvas = canvas;
    this.type = type; // 'single' or 'world'
    this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    this.animationFrameId = null;
    this.frameIndexes = Array(5).fill(0); // Initialize with 5 zeros for 5 layers
    this.showBeamEffect = false; // Default value
    this.beamAlpha = 0.5; // Default value
    this.fadeAlpha = 0.13; // Default value
    this.beamRenderMode = 'lines'; // Default value

    this.positionBuffer = null;
    this.colorBuffer = null;
    this.alphaBuffer = null;

    this.currentPointIndex = 0; // Tracks how many points have been drawn for the current frame
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
  }

  reset() {
    this.currentPointIndex = 0;
    this.frameIndexes.fill(0);
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
      this.renderWorld(data.worldData, data.previewScanRate);
    }
    else {
      this.renderSingle(data.ildaFrames, data.previewScanRate);
    }
  }

  renderSingle(ildaFrames, previewScanRate) {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!ildaFrames || ildaFrames.length === 0) {
      return;
    }

    const frame = ildaFrames[this.frameIndexes[0] % ildaFrames.length];
    this.draw(frame.points, this.showBeamEffect, this.beamAlpha, previewScanRate, this.beamRenderMode);

    this.frameIndexes[0]++;
    if (this.frameIndexes[0] >= ildaFrames.length) {
      this.frameIndexes[0] = 0;
    }
  }

  renderWorld(worldData, previewScanRate) {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    worldData.forEach((clip, index) => {
      if (clip && clip.frames && clip.frames.length > 0) {
        const frame = clip.frames[this.frameIndexes[index] % clip.frames.length];
        if (frame) { // Add null check for frame
          this.draw(frame.points, this.showBeamEffect, this.beamAlpha, previewScanRate, this.beamRenderMode);
        }
      }
    });

    worldData.forEach((clip, index) => {
      if (clip && clip.frames) {
        this.frameIndexes[index]++;
        if (this.frameIndexes[index] >= clip.frames.length) {
          this.frameIndexes[index] = 0;
        }
      }
    });
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

  draw(points, showBeamEffect, beamAlpha, previewScanRate, beamRenderMode) {
    const gl = this.gl;
    if (!points || points.length === 0) return;

    const pointsToDraw = Math.max(1, Math.floor(points.length / previewScanRate));
    const startIndex = this.currentPointIndex;
    const endIndex = Math.min(startIndex + pointsToDraw, points.length);

    // --- Helper function to draw normal frame segments ---
    const drawNormalFrame = () => {
      let currentSegmentPositions = [];
      let currentSegmentColors = [];
      for (let i = startIndex; i < endIndex; i++) {
        const point = points[i];
        if (point.blanking) {
          if (currentSegmentPositions.length > 0) {
            this._drawSegment(new Float32Array(currentSegmentPositions), new Float32Array(currentSegmentColors), 1.0, currentSegmentPositions.length / 2);
            currentSegmentPositions = [];
            currentSegmentColors = [];
          }
          continue;
        }
        currentSegmentPositions.push(point.x, point.y);
        currentSegmentColors.push(point.r / 255, point.g / 255, point.b / 255);
      }
      if (currentSegmentPositions.length > 0) {
        this._drawSegment(new Float32Array(currentSegmentPositions), new Float32Array(currentSegmentColors), 1.0, currentSegmentPositions.length / 2);
      }
    };

    // --- Helper function for 'points' mode (center-to-point beams) ---
    const drawPointsEffect = () => {
      const beamPositions = [];
      const beamColors = [];
      for (let i = startIndex; i < endIndex; i++) {
        const point = points[i];
        if (!point.blanking) {
          beamPositions.push(0, 0, point.x, point.y);
          const color = [point.r / 255, point.g / 255, point.b / 255];
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
      for (let i = startIndex + 1; i < endIndex; i++) {
        const p1 = points[i - 1];
        const p2 = points[i];
        if (!p1.blanking && !p2.blanking) {
          trianglePositions.push(0, 0, p1.x, p1.y, p2.x, p2.y);
          const color1 = [p1.r / 255, p1.g / 255, p1.b / 255];
          const color2 = [p2.r / 255, p2.g / 255, p2.b / 255];
          const centerColor = [(color1[0] + color2[0]) / 2, (color1[1] + color2[1]) / 2, (color1[2] + color2[2]) / 2];
          triangleColors.push(...centerColor, ...color1, ...color2);
        }
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

    this.currentPointIndex = (this.currentPointIndex + pointsToDraw) % points.length;
  }

  _drawSegment(positions, colors, alpha, numPoints) {
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
    const alphas = new Float32Array(Array(numPoints).fill(alpha));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.alphaBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, alphas);
    gl.enableVertexAttribArray(this.alphaAttributeLocation);
    gl.vertexAttribPointer(this.alphaAttributeLocation, 1, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.LINE_STRIP, 0, numPoints);
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
    const alphas = new Float32Array(Array(numPoints).fill(alpha));
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
    const alphas = new Float32Array(Array(numPoints).fill(alpha));
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
  }
}
