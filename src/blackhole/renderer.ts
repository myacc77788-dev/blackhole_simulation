import { VERT, SCENE_FRAG, BRIGHT_FRAG, BLUR_FRAG, COMPOSITE_FRAG } from './shaders';

export interface BHParams {
  steps: number;
  diskInner: number;
  diskOuter: number;
  diskBright: number;
  diskThick: number;
  diskTemp: number;
  diskNoise: number;
  spin: number;
  doppler: number;
  lensing: number;
  stars: number;
  nebula: number;
  jet: number;
  exposure: number;
  bloom: number;
  fov: number;
  renderScale: number;
  autoOrbit: boolean;
  paused: boolean;
}

export const DEFAULT_PARAMS: BHParams = {
  steps: 320,
  diskInner: 3.0,
  diskOuter: 22.0,
  diskBright: 1.0,
  diskThick: 0.28,
  diskTemp: 9500,
  diskNoise: 0.85,
  spin: 1.0,
  doppler: 1.0,
  lensing: 1.0,
  stars: 1.0,
  nebula: 1.0,
  jet: 0.0,
  exposure: 1.15,
  bloom: 0.75,
  fov: 52,
  renderScale: 1.0,
  autoOrbit: false,
  paused: false,
};

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile error: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

function program(gl: WebGL2RenderingContext, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Link error: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export class BlackHoleRenderer {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  params: BHParams;
  // camera
  dist = 16;
  yaw = 0.6;
  pitch = 0.13;
  targetDist = 16;

  private progScene: WebGLProgram;
  private progBright: WebGLProgram;
  private progBlur: WebGLProgram;
  private progComp: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private scene!: Target;
  private bloomA!: Target;
  private bloomB!: Target;
  private hdr: boolean;
  private raf = 0;
  private time = 0;
  private last = 0;
  private w = 1;
  private h = 1;
  private dragging = false;
  private px = 0;
  private py = 0;
  private pinchDist = 0;
  onFps?: (fps: number) => void;
  private frames = 0;
  private fpsT = 0;

  constructor(canvas: HTMLCanvasElement, params: BHParams) {
    this.canvas = canvas;
    this.params = params;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 is not supported by this browser.');
    this.gl = gl;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    this.progScene = program(gl, SCENE_FRAG);
    this.progBright = program(gl, BRIGHT_FRAG);
    this.progBlur = program(gl, BLUR_FRAG);
    this.progComp = program(gl, COMPOSITE_FRAG);
    this.vao = gl.createVertexArray()!;

    this.resize();
    this.attachEvents();
  }

  private makeTarget(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const internal = this.hdr ? gl.RGBA16F : gl.RGBA8;
    const type = this.hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, w, h };
  }

  private disposeTarget(t?: Target) {
    if (!t) return;
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.tex);
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = this.params.renderScale;
    const cw = this.canvas.clientWidth || 1;
    const ch = this.canvas.clientHeight || 1;
    const w = Math.max(2, Math.floor(cw * dpr * scale));
    const h = Math.max(2, Math.floor(ch * dpr * scale));
    if (w === this.w && h === this.h && this.scene) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.disposeTarget(this.scene);
    this.disposeTarget(this.bloomA);
    this.disposeTarget(this.bloomB);
    this.scene = this.makeTarget(w, h);
    const bw = Math.max(2, w >> 1);
    const bh = Math.max(2, h >> 1);
    this.bloomA = this.makeTarget(bw, bh);
    this.bloomB = this.makeTarget(bw, bh);
    gl.viewport(0, 0, w, h);
  }

  private attachEvents() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.px = e.clientX;
      this.py = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.px;
      const dy = e.clientY - this.py;
      this.px = e.clientX;
      this.py = e.clientY;
      this.yaw -= dx * 0.005;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 0.004));
    });
    const end = (e: PointerEvent) => {
      this.dragging = false;
      try {
        c.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.targetDist = Math.max(3.2, Math.min(70, this.targetDist * Math.exp(e.deltaY * 0.0012)));
      },
      { passive: false },
    );
    c.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const d = Math.hypot(dx, dy);
        if (this.pinchDist > 0) {
          this.targetDist = Math.max(3.2, Math.min(70, this.targetDist * (this.pinchDist / d)));
        }
        this.pinchDist = d;
      }
    });
    c.addEventListener('touchend', () => (this.pinchDist = 0));
  }

  private drawQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private camMatrix(): { pos: Float32Array; mat: Float32Array } {
    const cp = Math.cos(this.pitch);
    const pos = new Float32Array([
      this.dist * cp * Math.sin(this.yaw),
      this.dist * Math.sin(this.pitch),
      this.dist * cp * Math.cos(this.yaw),
    ]);
    // forward = -normalize(pos)
    const inv = 1 / this.dist;
    const f = [-pos[0] * inv, -pos[1] * inv, -pos[2] * inv];
    const wu = [0, 1, 0];
    let r = [f[1] * wu[2] - f[2] * wu[1], f[2] * wu[0] - f[0] * wu[2], f[0] * wu[1] - f[1] * wu[0]];
    const rl = Math.hypot(r[0], r[1], r[2]) || 1;
    r = [r[0] / rl, r[1] / rl, r[2] / rl];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    // column-major mat3 (right, up, forward)
    const mat = new Float32Array([r[0], r[1], r[2], u[0], u[1], u[2], f[0], f[1], f[2]]);
    return { pos, mat };
  }

  private frame = (t: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min((t - this.last) / 1000, 0.05) : 0.016;
    this.last = t;
    if (!this.params.paused) this.time += dt;
    if (this.params.autoOrbit) this.yaw += dt * 0.06;
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 6);

    this.resize();
    const gl = this.gl;
    const p = this.params;
    const { pos, mat } = this.camMatrix();

    // ---------- scene pass (HDR)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, this.scene.w, this.scene.h);
    gl.useProgram(this.progScene);
    const u = (n: string) => gl.getUniformLocation(this.progScene, n);
    gl.uniform2f(u('uRes'), this.scene.w, this.scene.h);
    gl.uniform1f(u('uTime'), this.time);
    gl.uniform3fv(u('uCamPos'), pos);
    gl.uniformMatrix3fv(u('uCamMat'), false, mat);
    gl.uniform1f(u('uFov'), p.fov);
    gl.uniform1f(u('uSteps'), p.steps);
    gl.uniform1f(u('uDiskInner'), p.diskInner);
    gl.uniform1f(u('uDiskOuter'), Math.max(p.diskOuter, p.diskInner + 2));
    gl.uniform1f(u('uDiskBright'), p.diskBright);
    gl.uniform1f(u('uDiskThick'), p.diskThick);
    gl.uniform1f(u('uDiskTemp'), p.diskTemp);
    gl.uniform1f(u('uDiskNoise'), p.diskNoise);
    gl.uniform1f(u('uSpin'), p.spin);
    gl.uniform1f(u('uDoppler'), p.doppler);
    gl.uniform1f(u('uLensing'), p.lensing);
    gl.uniform1f(u('uStars'), p.stars);
    gl.uniform1f(u('uNebula'), p.nebula);
    gl.uniform1f(u('uJet'), p.jet);
    this.drawQuad();

    // ---------- bright pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
    gl.viewport(0, 0, this.bloomA.w, this.bloomA.h);
    gl.useProgram(this.progBright);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
    gl.uniform1i(gl.getUniformLocation(this.progBright, 'uTex'), 0);
    gl.uniform1f(gl.getUniformLocation(this.progBright, 'uThreshold'), 0.55);
    this.drawQuad();

    // ---------- separable blur, 2 iterations
    gl.useProgram(this.progBlur);
    const tl = gl.getUniformLocation(this.progBlur, 'uTex');
    const dl = gl.getUniformLocation(this.progBlur, 'uDir');
    let src = this.bloomA;
    let dst = this.bloomB;
    for (let i = 0; i < 3; i++) {
      const horiz = i % 2 === 0;
      const spread = 1 + i;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(tl, 0);
      gl.uniform2f(dl, horiz ? spread / src.w : 0, horiz ? 0 : spread / src.h);
      this.drawQuad();
      const tmp = src;
      src = dst;
      dst = tmp;
    }

    // ---------- composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.progComp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
    gl.uniform1i(gl.getUniformLocation(this.progComp, 'uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(gl.getUniformLocation(this.progComp, 'uBloom'), 1);
    gl.uniform1f(gl.getUniformLocation(this.progComp, 'uBloomAmt'), p.bloom);
    gl.uniform1f(gl.getUniformLocation(this.progComp, 'uExposure'), p.exposure);
    gl.uniform1f(gl.getUniformLocation(this.progComp, 'uTime'), this.time);
    gl.uniform1f(gl.getUniformLocation(this.progComp, 'uVignette'), 0.55);
    gl.uniform1f(gl.getUniformLocation(this.progComp, 'uGrain'), 0.012);
    this.drawQuad();

    // fps
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) {
      this.onFps?.(this.frames / this.fpsT);
      this.frames = 0;
      this.fpsT = 0;
    }
  };

  start() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setView(dist: number, yaw: number, pitch: number) {
    this.targetDist = dist;
    this.yaw = yaw;
    this.pitch = pitch;
  }

  screenshot(): string {
    return this.canvas.toDataURL('image/png');
  }

  dispose() {
    this.stop();
    this.disposeTarget(this.scene);
    this.disposeTarget(this.bloomA);
    this.disposeTarget(this.bloomB);
  }
}
