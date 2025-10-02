export class WebGLRenderer {
  constructor(canvas, type) {
    this.canvas = canvas;
    this.type = type; // 'single' or 'world'
    this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    this.animationFrameId = null;
    this.frameIndexes = [];
    this.showBeamEffect = false; // Default value
    this.beamAlpha = 0.5; // Default value

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
    console.log("Renderer received data:", data);
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
      this.renderWorld(data.worldData, data.drawSpeed);
    }
    else {
      this.renderSingle(data.ildaFrames, data.drawSpeed);
    }
  }

  setBeamEffect(enabled) {
    this.showBeamEffect = enabled;
    console.log("setBeamEffect:", enabled);
  }

  setBeamAlpha(alpha) {
    this.beamAlpha = alpha;
    console.log("setBeamAlpha:", alpha);
  }

  setFadeAlpha(alpha) {
    this.fadeAlpha = alpha;
    console.log("setFadeAlpha:", alpha);
  }

  draw(positions, colors, showBeamEffect, beamAlpha) {
    console.log("draw called with showBeamEffect:", showBeamEffect, "beamAlpha:", beamAlpha);
    const gl = this.gl;
    const numPoints = positions.length / 2;

    if (numPoints === 0) return;

    // Main draw call (solid color)
    const mainAlphas = new Float32Array(Array(numPoints).fill(1.0));
    this._drawSegment(positions, colors, mainAlphas, numPoints);

    // Beam effect draw call (if enabled)
    if (showBeamEffect) {
      const beamAlphas = new Float32Array(Array(numPoints).fill(beamAlpha));
      this._drawSegment(positions, colors, beamAlphas, numPoints);
    }
  }

  drawFadeQuad() {
    console.log("drawFadeQuad called with fadeAlpha:", this.fadeAlpha);
    const gl = this.gl;

    gl.useProgram(this.fadeProgram);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadPositionBuffer);
    gl.enableVertexAttribArray(this.fadePositionAttributeLocation);
    gl.vertexAttribPointer(this.fadePositionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    gl.uniform4f(this.fadeColorUniformLocation, 0.0, 0.0, 0.0, this.fadeAlpha);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  destroy() {
    cancelAnimationFrame(this.animationFrameId);
  }
}
