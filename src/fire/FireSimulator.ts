import { drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import { PingPong, RenderTarget, r32f, rg32f, rgba16f, rgba32f, type TextureFormat } from '../gl/target';
import { gridLayout, type Vec3 } from '../paint/PaintSimulator';
import gridSrc from '../paint/shaders/grid.glsl?raw';
import advectSrc from '../paint/shaders/advect.glsl?raw';
import curlSrc from '../paint/shaders/curl.glsl?raw';
import sceneSrc from './shaders/fireScene.glsl?raw';
import commonSrc from './shaders/fireCommon.glsl?raw';
import voxelizeSrc from './shaders/fireVoxelize.glsl?raw';
import forcesSrc from './shaders/fireForces.glsl?raw';
import divergenceSrc from './shaders/fireDivergence.glsl?raw';
import pressureSrc from './shaders/firePressure.glsl?raw';
import gradientSrc from './shaders/fireGradient.glsl?raw';
import reactSrc from './shaders/fireReact.glsl?raw';
import lightSrc from './shaders/lightAccum.glsl?raw';

export type { Vec3 };

/** A source of fuel, heat and smoke, in world units relative to the box centre. */
export interface Emitter {
  shape: 'ellipsoid' | 'ring' | 'burst';
  position: Vec3;
  /** Ellipsoid radii; for a ring, [ring radius, tube radius, unused]. */
  size: Vec3;
  /** Velocity imposed on the gas (burst: [outward speed, upward speed, unused]). */
  velocity: Vec3;
  /** How strongly the velocity is imposed (0 = not at all). */
  push: number;
  fuel: number;
  heat: number;
  smoke: number;
  /** 0 for a steady source, 1 for a fully flickering one. */
  flicker: number;
}

export interface FireParams {
  /** Upward acceleration per unit of temperature, world units / s^2. */
  buoyancy: number;
  /** Downward pull of smoke. */
  weight: number;
  swirl: number;
  burnRate: number;
  heatRelease: number;
  soot: number;
  cooling: number;
  smokeFade: number;
  /** Horizontal breeze in world units per second. */
  breeze: number;
  drag: number;
  timeScale: number;
  pressureIterations: number;
  paused: boolean;
}

export const MAX_EMITTERS = 8;

const REDUCE_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
out vec4 outSum;
// Sums a 4x4 block of the source texture.
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 4;
  ivec2 size = textureSize(uSrc, 0);
  vec4 sum = vec4(0.0);
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      ivec2 p = base + ivec2(x, y);
      if (p.x < size.x && p.y < size.y) sum += texelFetch(uSrc, p, 0);
    }
  }
  outSum = sum;
}
`;
const SHAPE_CODES = { ellipsoid: 0, ring: 1, burst: 2 };

/**
 * Fire and smoke on the atlas-backed 3D grid used by the paint solver. Temperature, smoke and
 * fuel ride on the flow; fuel burns into heat and soot, and heat makes the gas rise.
 */
export class FireSimulator {
  res: Vec3 = [1, 1, 1];
  cols = 1;
  cellSize = 1;
  time = 0;
  scene = 0;

  private vel!: PingPong;
  private state!: PingPong;
  private forward!: RenderTarget;
  private backward!: RenderTarget;
  private curl!: RenderTarget;
  private divergence!: RenderTarget;
  private pressure!: PingPong;
  private solid!: RenderTarget;
  private light!: RenderTarget;
  /** Successively smaller sums of the light texture, ending in a single texel. */
  private lightSums: RenderTarget[] = [];
  private voxelizedScene = -1;

  private readonly voxelize: Program;
  private readonly advect: Program;
  private readonly curlProgram: Program;
  private readonly forces: Program;
  private readonly divergenceProgram: Program;
  private readonly pressureProgram: Program;
  private readonly gradient: Program;
  private readonly react: Program;
  private readonly lightProgram: Program;
  private readonly reduce: Program;

  private readonly emitData = {
    pos: new Float32Array(MAX_EMITTERS * 4),
    size: new Float32Array(MAX_EMITTERS * 4),
    vel: new Float32Array(MAX_EMITTERS * 4),
    rate: new Float32Array(MAX_EMITTERS * 4),
  };
  private emitCount = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly boxHalf: Vec3,
  ) {
    const make = (src: string, name: string) => new Program(gl, FULLSCREEN_VS, gridSrc + sceneSrc + commonSrc + src, name);
    this.voxelize = make(voxelizeSrc, 'fireVoxelize');
    this.advect = new Program(gl, FULLSCREEN_VS, gridSrc + advectSrc, 'fireAdvect');
    this.curlProgram = new Program(gl, FULLSCREEN_VS, gridSrc + curlSrc, 'fireCurl');
    this.forces = make(forcesSrc, 'fireForces');
    this.divergenceProgram = make(divergenceSrc, 'fireDivergence');
    this.pressureProgram = make(pressureSrc, 'firePressure');
    this.gradient = make(gradientSrc, 'fireGradient');
    this.react = make(reactSrc, 'fireReact');
    this.lightProgram = make(lightSrc, 'fireLight');
    this.reduce = new Program(gl, FULLSCREEN_VS, REDUCE_FS, 'fireLightReduce');
  }

  get stateTexture(): WebGLTexture {
    return this.state.read.texture;
  }

  /**
   * One texel holding the fire's total glow (w) and its glow-weighted position (xyz), summed over
   * every cell (see lightAccum.glsl).
   */
  get lightTexture(): WebGLTexture {
    return this.lightSums[this.lightSums.length - 1].texture;
  }

  /** (Re)allocates the grid with `cellsX` cells across the box. */
  reset(cellsX: number): void {
    const layout = gridLayout(this.boxHalf, cellsX);
    this.cellSize = layout.cellSize;
    this.res = layout.res;
    this.cols = layout.cols;
    const { width: w, height: h } = layout;

    this.disposeTargets();
    const gl = this.gl;
    const half = rgba16f(gl);
    const halfNearest: TextureFormat = { ...half, filter: gl.NEAREST };
    this.vel = new PingPong(gl, w, h, half);
    this.state = new PingPong(gl, w, h, half);
    this.forward = new RenderTarget(gl, w, h, half);
    this.backward = new RenderTarget(gl, w, h, half);
    this.curl = new RenderTarget(gl, w, h, halfNearest);
    this.divergence = new RenderTarget(gl, w, h, rg32f(gl));
    this.pressure = new PingPong(gl, w, h, r32f(gl));
    this.solid = new RenderTarget(gl, w, h, halfNearest);
    this.light = new RenderTarget(gl, w, h, halfNearest);
    this.lightSums = [];
    for (let lw = w, lh = h; lw > 1 || lh > 1; ) {
      lw = Math.ceil(lw / 4);
      lh = Math.ceil(lh / 4);
      this.lightSums.push(new RenderTarget(gl, lw, lh, rgba32f(gl)));
    }
    this.voxelizedScene = -1;
    this.clear();
  }

  /** Puts out the fire and clears the air. */
  clear(): void {
    const gl = this.gl;
    const zero = [0, 0, 0, 0];
    for (const t of [this.vel.read, this.vel.write, this.state.read, this.state.write, this.pressure.read, this.pressure.write]) {
      t.bind();
      gl.clearBufferfv(gl.COLOR, 0, zero);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  step(dt: number, params: FireParams, emitters: Emitter[]): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    this.time += dt;
    this.packEmitters(emitters);

    const toCells = 1 / this.cellSize;
    const grid = (p: Program) => p.use().set('uRes', this.res).set('uCols', this.cols);
    const fire = (p: Program) =>
      grid(p)
        .set('uScene', this.scene)
        .set('uGround', -this.boxHalf[1])
        .set('uBoxHalf', this.boxHalf)
        .set('uCellSize', this.cellSize)
        .set('uTime', this.time)
        .set('uEmitCount', this.emitCount)
        .set('uEmitPos', this.emitData.pos)
        .set('uEmitSize', this.emitData.size)
        .set('uEmitVel', this.emitData.vel)
        .set('uEmitRate', this.emitData.rate)
        .texture('uSolid', this.solid.texture);

    // 1. Sample the scenery into the grid when it changes.
    if (this.voxelizedScene !== this.scene) {
      this.solid.bind();
      fire(this.voxelize);
      drawFullscreen(gl);
      this.voxelizedScene = this.scene;
    }

    // 2. Advect velocity by itself.
    this.vel.write.bind();
    grid(this.advect)
      .set('uDt', dt)
      .set('uDissipation', 1)
      .texture('uVel', this.vel.read.texture)
      .texture('uSrc', this.vel.read.texture);
    drawFullscreen(gl);
    this.vel.swap();

    // 3. Buoyancy, vorticity confinement, breeze and emitter velocities.
    this.curl.bind();
    grid(this.curlProgram).texture('uVel', this.vel.read.texture);
    drawFullscreen(gl);

    this.vel.write.bind();
    fire(this.forces)
      .set('uDt', dt)
      .set('uVorticity', params.swirl)
      .set('uBuoyancy', params.buoyancy * toCells)
      .set('uWeight', params.weight * toCells)
      .set('uBreeze', [params.breeze * toCells, 0])
      .set('uBreezeRate', params.breeze !== 0 ? 0.8 : 0)
      .texture('uVel', this.vel.read.texture)
      .texture('uCurl', this.curl.texture)
      .texture('uState', this.state.read.texture);
    drawFullscreen(gl);
    this.vel.swap();

    // 4. Pressure projection, warm-started from the previous frame.
    this.divergence.bind();
    fire(this.divergenceProgram).texture('uVel', this.vel.read.texture);
    drawFullscreen(gl);

    const pressure = fire(this.pressureProgram).texture('uDiv', this.divergence.texture);
    for (let i = 0; i < params.pressureIterations; i++) {
      this.pressure.write.bind();
      pressure.texture('uPressure', this.pressure.read.texture);
      drawFullscreen(gl);
      this.pressure.swap();
    }

    this.vel.write.bind();
    fire(this.gradient)
      .set('uDissipation', Math.exp(-params.drag * dt))
      .texture('uPressure', this.pressure.read.texture)
      .texture('uVel', this.vel.read.texture);
    drawFullscreen(gl);
    this.vel.swap();

    // 5. Carry temperature, smoke and fuel along, then emit and burn.
    const advect = grid(this.advect).set('uDissipation', 1).texture('uVel', this.vel.read.texture);
    this.forward.bind();
    advect.set('uDt', dt).texture('uSrc', this.state.read.texture);
    drawFullscreen(gl);
    this.backward.bind();
    advect.set('uDt', -dt).texture('uSrc', this.forward.texture);
    drawFullscreen(gl);

    this.state.write.bind();
    fire(this.react)
      .set('uDt', dt)
      .set('uIgnition', 0.1)
      .set('uBurnRate', params.burnRate)
      .set('uHeatRelease', params.heatRelease)
      .set('uSoot', params.soot)
      .set('uCooling', params.cooling)
      .set('uSmokeFade', params.smokeFade)
      .texture('uVel', this.vel.read.texture)
      .texture('uState', this.state.read.texture)
      .texture('uForward', this.forward.texture)
      .texture('uBackward', this.backward.texture);
    drawFullscreen(gl);
    this.state.swap();

    this.updateLight();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.depthMask(true);
  }

  /** Recomputes the fire's overall glow, also used while paused so the lighting stays right. */
  updateLight(): void {
    const gl = this.gl;
    this.light.bind();
    this.lightProgram
      .use()
      .set('uRes', this.res)
      .set('uCols', this.cols)
      .set('uBoxHalf', this.boxHalf)
      .set('uCellSize', this.cellSize)
      .texture('uState', this.state.read.texture);
    drawFullscreen(gl);
    let src = this.light;
    for (const dst of this.lightSums) {
      dst.bind();
      this.reduce.use().texture('uSrc', src.texture);
      drawFullscreen(gl);
      src = dst;
    }
  }

  private packEmitters(emitters: Emitter[]): void {
    const [hx, hy, hz] = this.boxHalf;
    const s = 1 / this.cellSize;
    const d = this.emitData;
    this.emitCount = Math.min(emitters.length, MAX_EMITTERS);
    for (let i = 0; i < this.emitCount; i++) {
      const e = emitters[i];
      const minSize = 0.7;
      d.pos.set([(e.position[0] + hx) * s, (e.position[1] + hy) * s, (e.position[2] + hz) * s, SHAPE_CODES[e.shape]], i * 4);
      d.size.set(e.size.map((v) => Math.max(v * s, minSize)).concat(0), i * 4);
      d.vel.set([e.velocity[0] * s, e.velocity[1] * s, e.velocity[2] * s, e.push], i * 4);
      d.rate.set([e.fuel, e.heat, e.smoke, e.flicker], i * 4);
    }
  }

  private disposeTargets(): void {
    this.vel?.dispose();
    this.state?.dispose();
    this.forward?.dispose();
    this.backward?.dispose();
    this.curl?.dispose();
    this.divergence?.dispose();
    this.pressure?.dispose();
    this.solid?.dispose();
    this.light?.dispose();
    for (const t of this.lightSums) t.dispose();
  }
}
