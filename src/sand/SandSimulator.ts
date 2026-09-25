import { bindEmptyVao, drawFullscreen, FULLSCREEN_VS, UnsupportedError } from '../gl/context';
import { Program } from '../gl/program';
import { RenderTarget, rgba32f } from '../gl/target';
import { gridLayout } from '../paint/PaintSimulator';
import mpmSrc from '../honey/shaders/mpm.glsl?raw';
import sceneSrc from './shaders/sandScene.glsl?raw';
import p2gVs from './shaders/p2g.vert.glsl?raw';
import p2gFs from '../honey/shaders/p2g.frag.glsl?raw';
import gridUpdateSrc from './shaders/gridUpdate.glsl?raw';
import moveSrc from './shaders/g2pMove.glsl?raw';
import deformSrc from './shaders/g2pDeform.glsl?raw';

export type Vec3 = [number, number, number];

/** Material codes, matching g2pDeform.glsl. */
export const enum MaterialCode {
  Sand = 0,
  WetSand = 1,
  Snow = 2,
  Jelly = 3,
  Coal = 4,
  Carrot = 5,
}

export interface SandParams {
  /** Speed of sound in the material, world units / s; higher is stiffer but needs more substeps. */
  stiffness: number;
  gravity: number;
  /** Friction against the sandbox and the ball. */
  friction: number;
  substeps: number;
  timeScale: number;
  paused: boolean;
}

export interface Ball {
  on: boolean;
  position: Vec3;
  velocity: Vec3;
  radius: number;
}

const TEX_WIDTH = 512;
const PARTICLES_PER_CELL_AXIS = 2;
const MAX_SUBSTEPS = 16;

/** Four float textures rendered together with multiple render targets. */
class Quad {
  readonly textures: WebGLTexture[] = [];
  readonly framebuffer: WebGLFramebuffer;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    width: number,
    height: number,
  ) {
    this.framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    for (let i = 0; i < 4; i++) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
      this.textures.push(tex);
    }
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Particle framebuffer incomplete (0x${status.toString(16)})`);
  }

  dispose(): void {
    for (const t of this.textures) this.gl.deleteTexture(t);
    this.gl.deleteFramebuffer(this.framebuffer);
  }
}

/**
 * Sand, snow and other elastoplastic materials with the Material Point Method (MLS-MPM). Each
 * particle tracks its deformation gradient F: sand yields by Drucker-Prager friction, snow by
 * clamping F's singular values with hardening, and jelly is purely elastic.
 *
 * Particle state lives in two sets of four textures, each ping-ponged: motion (position with the
 * material code, velocity, affine velocity C) and deformation (F, the resulting stress, and
 * snow's plastic volume change Jp).
 */
export class SandSimulator {
  readonly texWidth = TEX_WIDTH;
  count = 0;
  capacity = 0;
  dx = 1;
  res: Vec3 = [1, 1, 1];
  cols = 1;

  private motion!: Quad;
  private motionNext!: Quad;
  private deform!: Quad;
  private deformNext!: Quad;
  private grid!: RenderTarget;
  private gridVel!: RenderTarget;

  private readonly p2g: Program;
  private readonly gridUpdate: Program;
  private readonly move: Program;
  private readonly deformProgram: Program;
  private readonly origin: Vec3;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly boxHalf: Vec3,
  ) {
    if (!gl.getExtension('EXT_float_blend')) {
      throw new UnsupportedError('Your GPU or browser cannot blend floating-point textures (EXT_float_blend is missing).');
    }
    this.origin = [-boxHalf[0], -boxHalf[1], -boxHalf[2]];
    const header = mpmSrc + sceneSrc;
    this.p2g = new Program(gl, header + p2gVs, p2gFs, 'sandP2G');
    this.gridUpdate = new Program(gl, FULLSCREEN_VS, header + gridUpdateSrc, 'sandGridUpdate');
    this.move = new Program(gl, FULLSCREEN_VS, header + moveSrc, 'sandMove');
    this.deformProgram = new Program(gl, FULLSCREEN_VS, header + deformSrc, 'sandDeform');
  }

  get positionTexture(): WebGLTexture {
    return this.motion.textures[0];
  }

  get radius(): number {
    return this.spacing;
  }

  get spacing(): number {
    return this.dx / PARTICLES_PER_CELL_AXIS;
  }

  reset(cellsX: number, capacity: number): void {
    this.disposeTargets();
    const gl = this.gl;
    const layout = gridLayout(this.boxHalf, cellsX);
    this.dx = layout.cellSize;
    this.res = layout.res;
    this.cols = layout.cols;
    const rows = Math.ceil(capacity / TEX_WIDTH);
    this.capacity = rows * TEX_WIDTH;
    this.motion = new Quad(gl, TEX_WIDTH, rows);
    this.motionNext = new Quad(gl, TEX_WIDTH, rows);
    this.deform = new Quad(gl, TEX_WIDTH, rows);
    this.deformNext = new Quad(gl, TEX_WIDTH, rows);
    this.grid = new RenderTarget(gl, layout.width, layout.height, rgba32f(gl));
    this.gridVel = new RenderTarget(gl, layout.width, layout.height, rgba32f(gl));
    this.count = 0;
  }

  clear(): void {
    this.count = 0;
  }

  /** Adds particles of one material at world positions (xyz triples). Returns how many fitted. */
  addParticles(positions: Float32Array, material: MaterialCode, velocity: Vec3): number {
    const n = Math.min(positions.length / 3, this.capacity - this.count);
    if (n <= 0) return 0;
    const [vx, vy, vz] = velocity.map((v) => v / this.dx);
    const pos = new Float32Array(n * 4);
    const vel = new Float32Array(n * 4);
    const zero = new Float32Array(n * 4);
    const f0 = new Float32Array(n * 4);
    const f1 = new Float32Array(n * 4);
    const s1 = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      // The fractional part is a random seed for each grain's colour.
      pos.set([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], material + Math.random() * 0.98], i * 4);
      vel.set([vx, vy, vz, 0], i * 4);
      f0[i * 4] = 1;
      f1[i * 4] = 1;
      s1[i * 4 + 2] = 1;
      s1[i * 4 + 3] = 1;
    }
    this.upload(this.motion, [pos, vel, zero, zero], n);
    this.upload(this.deform, [f0, f1, zero, s1], n);
    this.count += n;
    return n;
  }

  private upload(target: Quad, data: Float32Array[], n: number): void {
    const gl = this.gl;
    for (let i = 0; i < n; ) {
      const index = this.count + i;
      const x = index % TEX_WIDTH;
      const y = Math.floor(index / TEX_WIDTH);
      const len = Math.min(TEX_WIDTH - x, n - i);
      data.forEach((d, t) => {
        gl.bindTexture(gl.TEXTURE_2D, target.textures[t]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, len, 1, gl.RGBA, gl.FLOAT, d.subarray(i * 4, (i + len) * 4));
      });
      i += len;
    }
  }

  step(dt: number, params: SandParams, ball: Ball, ballFrom: Vec3): void {
    if (this.count === 0) return;
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    // Stress waves must not cross much more than half a cell per substep.
    const stable = Math.ceil((dt * params.stiffness) / (0.6 * this.dx));
    const substeps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.round(params.substeps), stable));
    const h = dt / substeps;
    const rows = this.capacity / TEX_WIDTH;
    const stiffness = (params.stiffness / this.dx) ** 2;
    const to = ball.position;

    for (let s = 0; s < substeps; s++) {
      const f = (s + 1) / substeps;
      const ballPos: Vec3 = [ballFrom[0] + (to[0] - ballFrom[0]) * f, ballFrom[1] + (to[1] - ballFrom[1]) * f, ballFrom[2] + (to[2] - ballFrom[2]) * f];
      const common = (p: Program) =>
        p
          .use()
          .set('uRes', this.res)
          .set('uCols', this.cols)
          .set('uDx', this.dx)
          .set('uOrigin', this.origin)
          .set('uBallOn', ball.on)
          .set('uBallPos', ballPos)
          .set('uBallVel', ball.velocity)
          .set('uBallRadius', ball.radius)
          .set('uDt', h)
          .set('uTexW', TEX_WIDTH)
          .set('uCount', this.count);
      const [pos, vel, c1, c2] = this.motion.textures;
      const [f0, f1, s0, s1] = this.deform.textures;

      // 1. Particles to grid.
      this.grid.bind();
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      common(this.p2g)
        .set('uAtlasSize', [this.grid.width, this.grid.height])
        .set('uParticleMass', 1 / PARTICLES_PER_CELL_AXIS ** 3)
        .texture('uPos', pos)
        .texture('uVel', vel)
        .texture('uC1', c1)
        .texture('uC2', c2)
        .texture('uS0', s0)
        .texture('uS1', s1);
      bindEmptyVao(gl);
      gl.drawArraysInstanced(gl.POINTS, 0, this.count, 27);
      gl.disable(gl.BLEND);

      // 2. Grid velocities, gravity and friction.
      this.gridVel.bind();
      common(this.gridUpdate)
        .set('uGravity', params.gravity / this.dx)
        .set('uFriction', params.friction)
        .texture('uGrid', this.grid.texture);
      drawFullscreen(gl);

      // 3. Grid to particles: move them...
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.motionNext.framebuffer);
      gl.viewport(0, 0, TEX_WIDTH, rows);
      common(this.move)
        .texture('uPos', pos)
        .texture('uVel', vel)
        .texture('uC1', c1)
        .texture('uC2', c2)
        .texture('uGridVel', this.gridVel.texture);
      drawFullscreen(gl);
      [this.motion, this.motionNext] = [this.motionNext, this.motion];

      // ...then deform them, apply plasticity and work out their stress.
      const [npos, nvel, nc1, nc2] = this.motion.textures;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.deformNext.framebuffer);
      common(this.deformProgram)
        .set('uStiffness', stiffness)
        .texture('uPos', npos)
        .texture('uVel', nvel)
        .texture('uC1', nc1)
        .texture('uC2', nc2)
        .texture('uF0', f0)
        .texture('uF1', f1)
        .texture('uS1', s1);
      drawFullscreen(gl);
      [this.deform, this.deformNext] = [this.deformNext, this.deform];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.depthMask(true);
  }

  private disposeTargets(): void {
    this.motion?.dispose();
    this.motionNext?.dispose();
    this.deform?.dispose();
    this.deformNext?.dispose();
    this.grid?.dispose();
    this.gridVel?.dispose();
  }
}
