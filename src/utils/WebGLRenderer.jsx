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
    const MAX_POINTS_PER_SEGMENT = 1000; // Max points in a single continuous segment

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
    this.draw(frame.points, this.showBeamEffect, this.beamAlpha, previewScanRate);

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
          this.draw(frame.points, this.showBeamEffect, this.beamAlpha, previewScanRate);
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

  draw(points, showBeamEffect, beamAlpha, previewScanRate) {
    const gl = this.gl;

    if (!points || points.length === 0) {
      return;
    }

    const pointsToDraw = Math.max(1, Math.floor(points.length / previewScanRate));
    const startIndex = this.currentPointIndex;
    let endIndex = (startIndex + pointsToDraw);

    // Ensure endIndex does not exceed points.length and wraps around correctly
    if (endIndex > points.length) {
      endIndex = points.length;
    }

    let currentSegmentPositions = [];
    let currentSegmentColors = [];
    let numPointsInSegment = 0;

    const drawSegment = (positions, colors, alpha, count) => {
      if (count > 0) {
        this._drawSegment(new Float32Array(positions), new Float32Array(colors), alpha, count);
      }
    };

    for (let i = startIndex; i < endIndex; i++) {
      const point = points[i];

      if (point.blanking) {
        if (numPointsInSegment > 0) {
          drawSegment(currentSegmentPositions, currentSegmentColors, 1.0, numPointsInSegment);
          if (showBeamEffect) {
            drawSegment(currentSegmentPositions, currentSegmentColors, beamAlpha, numPointsInSegment);
          }
        }
        currentSegmentPositions = [];
        currentSegmentColors = [];
        numPointsInSegment = 0;
        continue;
      }

      currentSegmentPositions.push(point.x, point.y);
      currentSegmentColors.push(point.r / 255, point.g / 255, point.b / 255);
      numPointsInSegment++;

      // If this is the last point of a segment or the frame, draw it
      if (i === endIndex -1 || point.lastPoint) {
        drawSegment(currentSegmentPositions, currentSegmentColors, 1.0, numPointsInSegment);
        if (showBeamEffect) {
          drawSegment(currentSegmentPositions, currentSegmentColors, beamAlpha, numPointsInSegment);
        }
        currentSegmentPositions = [];
        currentSegmentColors = [];
        numPointsInSegment = 0;
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

  clearCanvas() {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  destroy() {
    cancelAnimationFrame(this.animationFrameId);
  }
}
