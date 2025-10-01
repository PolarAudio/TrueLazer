export class WebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    this.animationFrameId = null;
    this.frameIndexes = [];

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
      varying vec3 vColor;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        vColor = aColor;
      }
    `;

    const fragmentShaderSource = `
      precision mediump float;
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
      }
    `;

    const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = this.createProgram(vertexShader, fragmentShader);

    this.program = program;
    this.positionAttributeLocation = gl.getAttribLocation(program, "aPosition");
    this.colorAttributeLocation = gl.getAttribLocation(program, "aColor");

    gl.useProgram(program);
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
    if (data.worldData) {
      this.renderWorld(data.worldData, data.drawSpeed);
    } else {
      this.renderSingle(data.ildaFrames, data.drawSpeed);
    }
  }

  renderSingle(frames, drawSpeed) {
    cancelAnimationFrame(this.animationFrameId);
    this.gl.clearColor(0, 0, 0, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    if (!frames || frames.length === 0) {
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        return;
    }

    let currentFrameIndex = 0;

    const renderLoop = () => {
      if (currentFrameIndex >= frames.length) {
        currentFrameIndex = 0;
      }

      this.drawFrame(frames[currentFrameIndex]);

      currentFrameIndex++;

      this.animationFrameId = setTimeout(() => {
        requestAnimationFrame(renderLoop);
      }, 1000 / drawSpeed);
    };

    renderLoop();
  }

  renderWorld(worldData, drawSpeed) {
    cancelAnimationFrame(this.animationFrameId);
    this.gl.clearColor(0, 0, 0, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    if (!worldData || worldData.length === 0) {
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        return;
    }

    const renderLoop = () => {
      this.gl.clearColor(0, 0, 0, 1);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);

      worldData.forEach((clip, clipIndex) => {
        if (clip && clip.frames && clip.frames.length > 0) {
          if (!this.frameIndexes[clipIndex] || this.frameIndexes[clipIndex] >= clip.frames.length) {
            this.frameIndexes[clipIndex] = 0;
          }
          this.drawFrame(clip.frames[this.frameIndexes[clipIndex]]);
          this.frameIndexes[clipIndex]++;
        }
      });

      this.animationFrameId = setTimeout(() => {
        requestAnimationFrame(renderLoop);
      }, 1000 / drawSpeed);
    };

    renderLoop();
  }

  drawFrame(frame) {
    const gl = this.gl;

    if (!frame || !frame.points) return;

    let positions = [];
    let colors = [];

    for (const point of frame.points) {
        if (point.blanking) {
            if (positions.length > 0) {
                this.draw(positions, colors);
                positions = [];
                colors = [];
            }
        } else {
            positions.push(point.x / 32767, -point.y / 32767);
            colors.push(point.r / 255, point.g / 255, point.b / 255);
        }
    }

    if (positions.length > 0) {
        this.draw(positions, colors);
    }
  }

  draw(positions, colors) {
    const gl = this.gl;
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(this.positionAttributeLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(this.positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    gl.enableVertexAttribArray(this.colorAttributeLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.vertexAttribPointer(this.colorAttributeLocation, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.LINE_STRIP, 0, positions.length / 2);
  }

  destroy() {
    cancelAnimationFrame(this.animationFrameId);
  }
}
