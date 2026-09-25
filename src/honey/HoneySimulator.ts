import { bindEmptyVao, drawFullscreen, FULLSCREEN_VS, UnsupportedError } from '../gl/context';
import { Program } from '../gl/program';
import { PingPong, RenderTarget, rgba16f, rgba32f, type TextureFormat } from '../gl/target';
import { gridLayout } from '../paint/PaintSimulator';
import mpmSrc from './shaders/mpm.glsl?raw';
import sceneSrc from './shaders/honeyScene.glsl?raw';
import p2gVs from './shaders/p2g.vert.glsl?raw';
import p2gFs from './shaders/p2g.frag.glsl?raw';
import gridUpdateSrc from './shaders/gridUpdate.glsl?raw';
import viscositySrc from './shaders/viscosity.glsl?raw';
import g2pSrc from './shaders/g2p.glsl?raw';

export type Vec3 = [number, number, number];

export interface HoneyParams {
  /** Kinematic viscosity, world units^2 / s. */
  viscosity: number;
  /** Speed of pressure waves, world units / s; higher is less squashy but needs more substeps. */
  stiffness: number;
  gravity: number;
  substeps: number;
  viscosityIterations: number;
  timeScale: number;
  paused: boolean;
}

/** The scenery's state for one step. */
export interface SceneState {
  scene: number;
  dipperOn: boolean;
  /** Dipper head position at the start and end of the step. */
  dipperFrom: Vec3;
  dipperTo: Vec3;
  dipperSpin: number;
  dipperAngle: number;
}

const TEX_WIDTH = 512;
/** Particles per cell along each axis. */
const PARTICLES_PER_CELL_AXIS = 2;

/** Particle state in four float textures, rendered together with multiple render targets. */
class ParticleBuffers {
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
 * Viscous liquid with the Material Point Method (MLS-MPM): particles carry the liquid and a
 * background grid does the physics each step. Particle-to-grid transfer is a scatter done with
 * additive point blending, viscosity is solved implicitly on the grid, and grid-to-particle
 * transfer gathers the new velocities back.
 */
export class HoneySimulator {
  readonly texWidth = TEX_WIDTH;
  count = 0;
  capacity = 0;
  /** World size of a grid cell. */
  dx = 1;
  res: Vec3 = [1, 1, 1];
  cols = 1;

  private particles!: ParticleBuffers;
  private particlesNext!: ParticleBuffers;
  private grid!: RenderTarget;
  private gridStar!: RenderTarget;
  private gridVel!: PingPong;

  private readonly p2g: Program;
  private readonly gridUpdate: Program;
  private readonly viscosity: Program;
  private readonly g2p: Program;
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
    this.p2g = new Program(gl, header + p2gVs, p2gFs, 'honeyP2G');
    this.gridUpdate = new Program(gl, FULLSCREEN_VS, header + gridUpdateSrc, 'honeyGridUpdate');
    this.viscosity = new Program(gl, FULLSCREEN_VS, header + viscositySrc, 'honeyViscosity');
    this.g2p = new Program(gl, FULLSCREEN_VS, header + g2pSrc, 'honeyG2P');
  }

  get positionTexture(): WebGLTexture {
    return this.particles.textures[0];
  }

  get velocityTexture(): WebGLTexture {
    return this.particles.textures[1];
  }

  /** World-space rendering radius of a particle. */
  get radius(): number {
    return (this.dx / PARTICLES_PER_CELL_AXIS) * 1.4;
  }

  /** Spacing at which to seed new particles, world units. */
  get spacing(): number {
    return this.dx / PARTICLES_PER_CELL_AXIS;
  }

  /** (Re)allocates the grid with `cellsX` cells across the domain and room for `capacity` particles. */
  reset(cellsX: number, capacity: number): void {
    this.disposeTargets();
    const gl = this.gl;
    const layout = gridLayout(this.boxHalf, cellsX);
    this.dx = layout.cellSize;
    this.res = layout.res;
    this.cols = layout.cols;
    const rows = Math.ceil(capacity / TEX_WIDTH);
    this.capacity = rows * TEX_WIDTH;
    this.particles = new ParticleBuffers(gl, TEX_WIDTH, rows);
    this.particlesNext = new ParticleBuffers(gl, TEX_WIDTH, rows);
    // Summing momentum needs full precision; the velocities the viscosity solve iterates on don't.
    const half: TextureFormat = { ...rgba16f(gl), filter: gl.NEAREST };
    this.grid = new RenderTarget(gl, layout.width, layout.height, rgba32f(gl));
    this.gridStar = new RenderTarget(gl, layout.width, layout.height, half);
    this.gridVel = new PingPong(gl, layout.width, layout.height, half);
    this.count = 0;
  }

  clear(): void {
    this.count = 0;
  }

  /**
   * Adds particles at the given world positions (xyz triples) moving at `velocity` (world units
   * per second). Returns how many fitted.
   */
  addParticles(positions: Float32Array, velocity: Vec3): number {
    const n = Math.min(positions.length / 3, this.capacity - this.count);
    if (n <= 0) return 0;
    const pos = new Float32Array(n * 4);
    const vel = new Float32Array(n * 4);
    const zero = new Float32Array(n * 4);
    const [vx, vy, vz] = velocity.map((v) => v / this.dx);
    for (let i = 0; i < n; i++) {
      pos.set([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], 1], i * 4);
      vel.set([vx, vy, vz, 0], i * 4);
    }
    const gl = this.gl;
    const data = [pos, vel, zero, zero];
    for (let i = 0; i < n; ) {
      const index = this.count + i;
      const x = index % TEX_WIDTH;
      const y = Math.floor(index / TEX_WIDTH);
      const len = Math.min(TEX_WIDTH - x, n - i);
      data.forEach((d, t) => {
        gl.bindTexture(gl.TEXTURE_2D, this.particles.textures[t]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, len, 1, gl.RGBA, gl.FLOAT, d.subarray(i * 4, (i + len) * 4));
      });
      i += len;
    }
    this.count += n;
    return n;
  }

  step(dt: number, params: HoneyParams, scene: SceneState): void {
    if (this.count === 0) return;
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    const substeps = Math.max(1, Math.round(params.substeps));
    const h = dt / substeps;
    const [w, hgt] = [this.grid.width, this.grid.height];
    const from = scene.dipperFrom;
    const to = scene.dipperTo;
    const dipperVel: Vec3 = [(to[0] - from[0]) / dt, (to[1] - from[1]) / dt, (to[2] - from[2]) / dt];
    const stiffness = (params.stiffness / this.dx) ** 2;
    const alpha = (params.viscosity / (this.dx * this.dx)) * h;

    for (let s = 0; s < substeps; s++) {
      const f = (s + 1) / substeps;
      const dipper: Vec3 = [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f];
      const common = (p: Program) =>
        p
          .use()
          .set('uRes', this.res)
          .set('uCols', this.cols)
          .set('uDx', this.dx)
          .set('uOrigin', this.origin)
          .set('uScene', scene.scene)
          .set('uDipperOn', scene.dipperOn)
          .set('uDipperPos', dipper)
          .set('uDipperVel', dipperVel)
          .set('uDipperSpin', scene.dipperSpin)
          .set('uDipperAngle', scene.dipperAngle)
          .set('uDt', h);
      const [pos, vel, c1, c2] = this.particles.textures;

      // 1. Particles to grid.
      this.grid.bind();
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      common(this.p2g)
        .set('uTexW', TEX_WIDTH)
        .set('uAtlasSize', [w, hgt])
        .set('uParticleMass', 1 / PARTICLES_PER_CELL_AXIS ** 3)
        .set('uStiffness', stiffness)
        .texture('uPos', pos)
        .texture('uVel', vel)
        .texture('uC1', c1)
        .texture('uC2', c2);
      bindEmptyVao(gl);
      gl.drawArraysInstanced(gl.POINTS, 0, this.count, 27);
      gl.disable(gl.BLEND);

      // 2. Grid velocities, gravity and collisions.
      this.gridStar.bind();
      common(this.gridUpdate)
        .set('uGravity', params.gravity / this.dx)
        .texture('uGrid', this.grid.texture);
      drawFullscreen(gl);

      // 3. Implicit viscosity.
      const visc = common(this.viscosity).set('uAlpha', alpha).texture('uStar', this.gridStar.texture);
      let current = this.gridStar;
      for (let i = 0; i < params.viscosityIterations; i++) {
        this.gridVel.write.bind();
        visc.texture('uIter', current.texture);
        drawFullscreen(gl);
        this.gridVel.swap();
        current = this.gridVel.read;
      }

      // 4. Grid to particles.
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.particlesNext.framebuffer);
      gl.viewport(0, 0, TEX_WIDTH, this.capacity / TEX_WIDTH);
      common(this.g2p)
        .set('uTexW', TEX_WIDTH)
        .set('uCount', this.count)
        .texture('uPos', pos)
        .texture('uVel', vel)
        .texture('uC1', c1)
        .texture('uC2', c2)
        .texture('uGridVel', current.texture);
      drawFullscreen(gl);
      [this.particles, this.particlesNext] = [this.particlesNext, this.particles];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.depthMask(true);
  }

  private disposeTargets(): void {
    this.particles?.dispose();
    this.particlesNext?.dispose();
    this.grid?.dispose();
    this.gridStar?.dispose();
    this.gridVel?.dispose();
  }
}
