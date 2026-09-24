import { drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import { PingPong, RenderTarget, rg32f, rgba32f } from '../gl/target';
import { BitonicSort } from './BitonicSort';
import { buildPreset, WATER_FRACTION, type PresetName } from './presets';
import commonSrc from './shaders/common.glsl?raw';
import kernelsSrc from './shaders/kernels.glsl?raw';
import keysSrc from './shaders/keys.glsl?raw';
import cellStartSrc from './shaders/cellStart.glsl?raw';
import reorderSrc from './shaders/reorder.glsl?raw';
import predictSrc from './shaders/predict.glsl?raw';
import densitySrc from './shaders/density.glsl?raw';
import forceSrc from './shaders/force.glsl?raw';
import integrateSrc from './shaders/integrate.glsl?raw';

export type Vec3 = [number, number, number];

export interface SimParams {
  particleCount: number;
  substeps: number;
  timeScale: number;
  gravity: number;
  pressure: number;
  nearPressure: number;
  viscosity: number;
  restitution: number;
  paused: boolean;
}

export const MOUSE_NONE = 0;
export const MOUSE_STIR = 1;
export const MOUSE_ATTRACT = 2;

/** Mouse interaction, expressed in container-local space. */
export interface MouseForce {
  mode: number;
  rayOrigin: Vec3;
  rayDir: Vec3;
  point: Vec3;
  velocity: Vec3;
  radius: number;
  strength: number;
}

export interface StepInput {
  /** Column-major mat3 mapping last frame's local space into this frame's local space. */
  frameRotation: Float32Array;
  /** Unit gravity direction in container-local space. */
  gravityDir: Vec3;
  mouse: MouseForce;
}

export interface SimStats {
  meanDensity: number;
  maxDensity: number;
  maxSpeed: number;
}

const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
// Texture widths are baked into the shaders as TEX_SHIFT / TEX_MASK in common.glsl.
const TEX_WIDTH = 256;
const CELL_TEX_WIDTH = 256;
const MAX_SPEED = 12;

export class SPHSimulator {
  count = 0;
  texWidth = TEX_WIDTH;
  texHeight = 0;
  /** Rest spacing between particles. */
  spacing = 0;
  /** Smoothing radius (also the grid cell size). */
  h = 0;
  /** Rendering radius of a particle. */
  radius = 0;
  private mass = 1;
  private gridRes: Vec3 = [1, 1, 1];
  private numCells = 1;

  private pos!: PingPong;
  private vel!: PingPong;
  private sorted!: PingPong;
  private pred!: RenderTarget;
  private density!: RenderTarget;
  private cellStart!: RenderTarget;

  private readonly sorter: BitonicSort;
  private readonly keysProgram: Program;
  private readonly cellStartProgram: Program;
  private readonly reorderProgram: Program;
  private readonly predictProgram: Program;
  private readonly densityProgram: Program;
  private readonly forceProgram: Program;
  private readonly integrateProgram: Program;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly boxHalf: Vec3,
  ) {
    const make = (src: string, name: string, withKernels = false) =>
      new Program(gl, FULLSCREEN_VS, commonSrc + (withKernels ? kernelsSrc : '') + src, name);
    this.sorter = new BitonicSort(gl);
    this.keysProgram = make(keysSrc, 'keys');
    this.cellStartProgram = make(cellStartSrc, 'cellStart');
    this.reorderProgram = make(reorderSrc, 'reorder');
    this.predictProgram = make(predictSrc, 'predict');
    this.densityProgram = make(densitySrc, 'density', true);
    this.forceProgram = make(forceSrc, 'force', true);
    this.integrateProgram = make(integrateSrc, 'integrate');
  }

  get positionTexture(): WebGLTexture {
    return this.pos.read.texture;
  }

  get velocityTexture(): WebGLTexture {
    return this.vel.read.texture;
  }

  reset(count: number, preset: PresetName): void {
    if ((count & (count - 1)) !== 0) throw new Error('Particle count must be a power of two');
    const gl = this.gl;
    const [hx, hy, hz] = this.boxHalf;

    this.count = count;
    this.texHeight = count / TEX_WIDTH;
    const waterVolume = WATER_FRACTION * 8 * hx * hy * hz;
    this.spacing = Math.cbrt(waterVolume / count);
    this.h = this.spacing * 2;
    this.radius = this.spacing * 0.6;
    this.mass = 1 / this.restDensityRaw(this.spacing, this.h);

    this.gridRes = [Math.ceil((2 * hx) / this.h), Math.ceil((2 * hy) / this.h), Math.ceil((2 * hz) / this.h)];
    this.numCells = this.gridRes[0] * this.gridRes[1] * this.gridRes[2];
    const cellTexHeight = Math.ceil(this.numCells / CELL_TEX_WIDTH);

    this.disposeTargets();
    const positions = buildPreset(preset, count, this.boxHalf, this.spacing);
    const w = TEX_WIDTH;
    const h = this.texHeight;
    this.pos = new PingPong(gl, w, h, rgba32f(gl), positions);
    this.vel = new PingPong(gl, w, h, rgba32f(gl), new Float32Array(count * 4));
    this.sorted = new PingPong(gl, w, h, rgba32f(gl));
    this.pred = new RenderTarget(gl, w, h, rgba32f(gl));
    this.density = new RenderTarget(gl, w, h, rg32f(gl));
    this.cellStart = new RenderTarget(gl, CELL_TEX_WIDTH, cellTexHeight, rg32f(gl));
  }

  /** Sum of the density kernel over a cubic lattice, i.e. the raw density of water at rest. */
  private restDensityRaw(spacing: number, h: number): number {
    const norm = 15 / (2 * Math.PI * h ** 5);
    const n = Math.ceil(h / spacing);
    let sum = 0;
    for (let x = -n; x <= n; x++) {
      for (let y = -n; y <= n; y++) {
        for (let z = -n; z <= n; z++) {
          const r = spacing * Math.hypot(x, y, z);
          if (r < h) sum += norm * (h - r) ** 2;
        }
      }
    }
    return sum;
  }

  /** Advances the simulation by one substep of length `dt`. */
  substep(dt: number, params: SimParams, input: StepInput, applyFrameRotation: boolean): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    const frameRot = applyFrameRotation ? input.frameRotation : IDENTITY3;
    const g = input.gravityDir;
    const gravity: Vec3 = [g[0] * params.gravity, g[1] * params.gravity, g[2] * params.gravity];

    const setShared = (p: Program) => {
      const m = input.mouse;
      p.use()
        .set('uBoxMin', [-this.boxHalf[0], -this.boxHalf[1], -this.boxHalf[2]])
        .set('uCellSize', this.h)
        .set('uGridRes', this.gridRes)
        .set('uFrameRot', frameRot)
        .set('uGravity', gravity)
        .set('uDt', dt)
        .set('uMouseMode', m.mode)
        .set('uRayOrigin', m.rayOrigin)
        .set('uRayDir', m.rayDir)
        .set('uMousePoint', m.point)
        .set('uMouseVel', m.velocity)
        .set('uMouseRadius', m.radius)
        .set('uMouseStrength', m.strength);
      return p;
    };
    const setKernels = (p: Program) => {
      const h = this.h;
      return p
        .set('uH', h)
        .set('uMass', this.mass)
        .set('uSpiky2Norm', 15 / (2 * Math.PI * h ** 5))
        .set('uSpiky3Norm', 15 / (Math.PI * h ** 6))
        .set('uPoly6Norm', 315 / (64 * Math.PI * h ** 9))
        .texture('uCellStart', this.cellStart.texture);
    };

    // 1. Cell key of each particle's predicted position.
    this.sorted.write.bind();
    setShared(this.keysProgram).texture('uPos', this.pos.read.texture).texture('uVel', this.vel.read.texture);
    drawFullscreen(gl);
    this.sorted.swap();

    // 2. Sort particles by cell.
    this.sorter.sort(this.sorted, this.count);

    // 3. Gather positions and velocities into sorted order (applying rotation and external forces).
    const reorder = setShared(this.reorderProgram)
      .texture('uSorted', this.sorted.read.texture)
      .texture('uPos', this.pos.read.texture)
      .texture('uVel', this.vel.read.texture);
    this.pos.write.bind();
    reorder.set('uOutput', 0);
    drawFullscreen(gl);
    this.vel.write.bind();
    reorder.set('uOutput', 1);
    drawFullscreen(gl);
    this.pos.swap();
    this.vel.swap();

    // 4. Predicted positions.
    this.pred.bind();
    setShared(this.predictProgram).texture('uPos', this.pos.read.texture).texture('uVel', this.vel.read.texture);
    drawFullscreen(gl);

    // 5. Start/end of every cell in the sorted list.
    this.cellStart.bind();
    setShared(this.cellStartProgram)
      .set('uCount', this.count)
      .set('uNumCells', this.numCells)
      .texture('uSorted', this.sorted.read.texture);
    drawFullscreen(gl);

    // 6. Density and near-density.
    this.density.bind();
    setKernels(setShared(this.densityProgram)).texture('uPred', this.pred.texture);
    drawFullscreen(gl);

    // 7. Pressure and viscosity forces.
    this.vel.write.bind();
    setKernels(setShared(this.forceProgram))
      .set('uTargetDensity', 1)
      .set('uPressureK', params.pressure)
      .set('uNearPressureK', params.nearPressure)
      .set('uViscosity', params.viscosity)
      .texture('uPred', this.pred.texture)
      .texture('uVel', this.vel.read.texture)
      .texture('uDensity', this.density.texture);
    drawFullscreen(gl);
    this.vel.swap();

    // 8. Integrate and collide with the container.
    const integrate = setShared(this.integrateProgram)
      .set('uBoxHalf', this.boxHalf)
      .set('uRadius', this.spacing * 0.25)
      .set('uRestitution', params.restitution)
      .set('uMaxSpeed', MAX_SPEED)
      .texture('uPos', this.pos.read.texture)
      .texture('uVel', this.vel.read.texture);
    this.pos.write.bind();
    integrate.set('uOutput', 0);
    drawFullscreen(gl);
    this.vel.write.bind();
    integrate.set('uOutput', 1);
    drawFullscreen(gl);
    this.pos.swap();
    this.vel.swap();

    gl.depthMask(true);
  }

  /** Reads back density and velocity to report simulation health. Slow; for debugging only. */
  readStats(): SimStats {
    const gl = this.gl;
    const n = this.count;
    const buf = new Float32Array(n * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.density.framebuffer);
    gl.readPixels(0, 0, this.texWidth, this.texHeight, gl.RGBA, gl.FLOAT, buf);
    let sum = 0;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const d = buf[i * 4];
      sum += d;
      if (d > max) max = d;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.vel.read.framebuffer);
    gl.readPixels(0, 0, this.texWidth, this.texHeight, gl.RGBA, gl.FLOAT, buf);
    let maxSpeed = 0;
    for (let i = 0; i < n; i++) {
      const s = Math.hypot(buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]);
      if (s > maxSpeed) maxSpeed = s;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { meanDensity: sum / n, maxDensity: max, maxSpeed };
  }

  private disposeTargets(): void {
    this.pos?.dispose();
    this.vel?.dispose();
    this.sorted?.dispose();
    this.pred?.dispose();
    this.density?.dispose();
    this.cellStart?.dispose();
  }
}
