import { drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import { PingPong, RenderTarget, rg32f, rgba32f } from '../gl/target';
import { BitonicSort } from '../sim/BitonicSort';
import { MOUSE_NONE, type MouseForce, type Vec3 } from '../sim/SPHSimulator';
import commonSrc from '../sim/shaders/common.glsl?raw';
import kernelsSrc from '../sim/shaders/kernels.glsl?raw';
import keysSrc from '../sim/shaders/keys.glsl?raw';
import cellStartSrc from '../sim/shaders/cellStart.glsl?raw';
import predictSrc from '../sim/shaders/predict.glsl?raw';
import densitySrc from '../sim/shaders/density.glsl?raw';
import lampSrc from './shaders/lamp.glsl?raw';
import reorderSrc from './shaders/reorder.glsl?raw';
import forceSrc from './shaders/force.glsl?raw';
import integrateSrc from './shaders/integrate.glsl?raw';

export interface LavaParams {
  /** Bulb power: how fast wax near the bottom heats up. */
  heat: number;
  /** How fast wax cools towards the temperature of the liquid around it. */
  cooling: number;
  /** Lift on hot wax and sink on cold wax, world units / s^2. */
  buoyancy: number;
  cohesion: number;
  viscosity: number;
  /** Drag of the liquid on the wax, 1 / s. */
  drag: number;
  pressure: number;
  nearPressure: number;
  substeps: number;
  timeScale: number;
  paused: boolean;
}

/** Must match lamp.glsl. */
export const LAMP = {
  bottom: -0.62,
  waist: -0.25,
  top: 0.62,
  rBottom: 0.17,
  rWaist: 0.25,
  rTop: 0.12,
};

export function lampRadius(y: number): number {
  const t = (a: number, b: number) => Math.min(1, Math.max(0, (y - a) / (b - a)));
  return y < LAMP.waist
    ? LAMP.rBottom + (LAMP.rWaist - LAMP.rBottom) * t(LAMP.bottom, LAMP.waist)
    : LAMP.rWaist + (LAMP.rTop - LAMP.rWaist) * t(LAMP.waist, LAMP.top);
}

/** Fraction of the lamp filled with wax. */
const WAX_FRACTION = 0.11;
const BOX_HALF: Vec3 = [LAMP.rWaist + 0.02, (LAMP.top - LAMP.bottom) / 2 + 0.02, LAMP.rWaist + 0.02];
const BOX_CENTER_Y = (LAMP.top + LAMP.bottom) / 2;
const TEX_WIDTH = 256;
const CELL_TEX_WIDTH = 256;
const MAX_SPEED = 3;
const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

function lampVolume(): number {
  let v = 0;
  const n = 400;
  const dy = (LAMP.top - LAMP.bottom) / n;
  for (let i = 0; i < n; i++) v += Math.PI * lampRadius(LAMP.bottom + (i + 0.5) * dy) ** 2 * dy;
  return v;
}

/**
 * The wax in a lava lamp, as SPH particles (the water page's solver) that also carry a
 * temperature. The liquid around the wax isn't simulated: it only lifts, sinks and drags the wax.
 */
export class LavaSimulator {
  count = 0;
  readonly texWidth = TEX_WIDTH;
  spacing = 0;
  h = 0;
  radius = 0;
  private mass = 1;
  private gridRes: Vec3 = [1, 1, 1];
  private numCells = 1;
  private readonly boxMin: Vec3 = [-BOX_HALF[0], BOX_CENTER_Y - BOX_HALF[1], -BOX_HALF[2]];

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

  constructor(private readonly gl: WebGL2RenderingContext) {
    const make = (src: string, name: string, withKernels = false) =>
      new Program(gl, FULLSCREEN_VS, commonSrc + lampSrc + (withKernels ? kernelsSrc : '') + src, name);
    this.sorter = new BitonicSort(gl);
    this.keysProgram = make(keysSrc, 'lavaKeys');
    this.cellStartProgram = make(cellStartSrc, 'lavaCellStart');
    this.reorderProgram = make(reorderSrc, 'lavaReorder');
    this.predictProgram = make(predictSrc, 'lavaPredict');
    this.densityProgram = make(densitySrc, 'lavaDensity', true);
    this.forceProgram = make(forceSrc, 'lavaForce', true);
    this.integrateProgram = make(integrateSrc, 'lavaIntegrate');
  }

  get positionTexture(): WebGLTexture {
    return this.pos.read.texture;
  }

  get velocityTexture(): WebGLTexture {
    return this.vel.read.texture;
  }

  /** Allocates `count` wax particles (a power of two), pooled cool at the bottom of the lamp. */
  reset(count: number): void {
    if ((count & (count - 1)) !== 0) throw new Error('Particle count must be a power of two');
    const gl = this.gl;
    this.count = count;
    this.spacing = Math.cbrt((WAX_FRACTION * lampVolume()) / count);
    this.h = this.spacing * 2;
    this.radius = this.spacing * 0.6;
    this.mass = 1 / this.restDensityRaw(this.spacing, this.h);
    this.gridRes = BOX_HALF.map((b) => Math.ceil((2 * b) / this.h)) as Vec3;
    this.numCells = this.gridRes[0] * this.gridRes[1] * this.gridRes[2];

    this.disposeTargets();
    const rows = count / TEX_WIDTH;
    const { positions, velocities } = this.pool(count);
    this.pos = new PingPong(gl, TEX_WIDTH, rows, rgba32f(gl), positions);
    this.vel = new PingPong(gl, TEX_WIDTH, rows, rgba32f(gl), velocities);
    this.sorted = new PingPong(gl, TEX_WIDTH, rows, rgba32f(gl));
    this.pred = new RenderTarget(gl, TEX_WIDTH, rows, rgba32f(gl));
    this.density = new RenderTarget(gl, TEX_WIDTH, rows, rg32f(gl));
    this.cellStart = new RenderTarget(gl, CELL_TEX_WIDTH, Math.ceil(this.numCells / CELL_TEX_WIDTH), rg32f(gl));
  }

  /** Wax on a jittered lattice filling the lamp from the bottom, warmer the lower it is. */
  private pool(count: number): { positions: Float32Array; velocities: Float32Array } {
    const s = this.spacing;
    const positions = new Float32Array(count * 4);
    const velocities = new Float32Array(count * 4);
    let n = 0;
    for (let y = LAMP.bottom + s * 0.6; n < count; y += s) {
      const r = lampRadius(y) - s * 0.6;
      for (let x = -r; x <= r && n < count; x += s) {
        for (let z = -r; z <= r && n < count; z += s) {
          if (x * x + z * z > r * r) continue;
          const j = () => (Math.random() - 0.5) * s * 0.2;
          positions.set([x + j(), y + j(), z + j(), 1], n * 4);
          velocities[n * 4 + 3] = 0.5 - (y - LAMP.bottom) * 1.5 + Math.random() * 0.05;
          n++;
        }
      }
    }
    return { positions, velocities };
  }

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

  substep(dt: number, params: LavaParams, mouse: MouseForce | null): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    const shared = (p: Program) => {
      p.use()
        .set('uBoxMin', this.boxMin)
        .set('uCellSize', this.h)
        .set('uGridRes', this.gridRes)
        .set('uFrameRot', IDENTITY3)
        .set('uGravity', [0, 0, 0])
        .set('uDt', dt)
        .set('uMouseMode', mouse?.mode ?? MOUSE_NONE);
      if (mouse) {
        p.set('uRayOrigin', mouse.rayOrigin)
          .set('uRayDir', mouse.rayDir)
          .set('uMousePoint', mouse.point)
          .set('uMouseVel', mouse.velocity)
          .set('uMouseRadius', mouse.radius)
          .set('uMouseStrength', mouse.strength);
      }
      return p;
    };
    const kernels = (p: Program) => {
      const h = this.h;
      return p
        .set('uH', h)
        .set('uMass', this.mass)
        .set('uSpiky2Norm', 15 / (2 * Math.PI * h ** 5))
        .set('uSpiky3Norm', 15 / (Math.PI * h ** 6))
        .set('uPoly6Norm', 315 / (64 * Math.PI * h ** 9))
        .texture('uCellStart', this.cellStart.texture);
    };

    this.sorted.write.bind();
    shared(this.keysProgram).texture('uPos', this.pos.read.texture).texture('uVel', this.vel.read.texture);
    drawFullscreen(gl);
    this.sorted.swap();
    this.sorter.sort(this.sorted, this.count);

    const reorder = shared(this.reorderProgram)
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

    this.pred.bind();
    shared(this.predictProgram).texture('uPos', this.pos.read.texture).texture('uVel', this.vel.read.texture);
    drawFullscreen(gl);

    this.cellStart.bind();
    shared(this.cellStartProgram)
      .set('uCount', this.count)
      .set('uNumCells', this.numCells)
      .texture('uSorted', this.sorted.read.texture);
    drawFullscreen(gl);

    this.density.bind();
    kernels(shared(this.densityProgram)).texture('uPred', this.pred.texture);
    drawFullscreen(gl);

    this.vel.write.bind();
    kernels(shared(this.forceProgram))
      .set('uPressureK', params.pressure)
      .set('uNearPressureK', params.nearPressure)
      .set('uViscosity', params.viscosity)
      .set('uCohesion', params.cohesion)
      .set('uCohesionNorm', 32 / (Math.PI * this.h ** 9))
      .set('uBuoyancy', params.buoyancy)
      .set('uDrag', params.drag)
      .set('uHeatDiffusion', (params as { diffusion?: number }).diffusion ?? 1)
      .set('uHeat', params.heat)
      .set('uCool', params.cooling)
      .texture('uPred', this.pred.texture)
      .texture('uVel', this.vel.read.texture)
      .texture('uDensity', this.density.texture);
    drawFullscreen(gl);
    this.vel.swap();

    const integrate = shared(this.integrateProgram)
      .set('uRadius', this.spacing * 0.4)
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

  private disposeTargets(): void {
    this.pos?.dispose();
    this.vel?.dispose();
    this.sorted?.dispose();
    this.pred?.dispose();
    this.density?.dispose();
    this.cellStart?.dispose();
  }
}
