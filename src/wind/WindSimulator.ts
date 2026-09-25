import { drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import { PingPong, RenderTarget, r32f, rgba16f, type TextureFormat } from '../gl/target';
import { gridLayout } from '../paint/PaintSimulator';
import gridSrc from '../paint/shaders/grid.glsl?raw';
import advectSrc from '../paint/shaders/advect.glsl?raw';
import curlSrc from '../paint/shaders/curl.glsl?raw';
import obstacleSrc from './shaders/obstacle.glsl?raw';
import tunnelSrc from './shaders/tunnel.glsl?raw';
import voxelizeSrc from './shaders/voxelize.glsl?raw';
import forcesSrc from './shaders/windForces.glsl?raw';
import divergenceSrc from './shaders/windDivergence.glsl?raw';
import pressureSrc from './shaders/windPressure.glsl?raw';
import gradientSrc from './shaders/windGradient.glsl?raw';
import smokeSrc from './shaders/windSmoke.glsl?raw';
import type { Obstacle, Vec3 } from './obstacle';

export interface WindParams {
  /** Free-stream speed in world units per second. */
  wind: number;
  /** Size of the inflow wobble relative to the wind speed. */
  turbulence: number;
  /** Strength of vorticity confinement. */
  swirl: number;
  timeScale: number;
  pressureIterations: number;
  paused: boolean;
}

export type RakeMode = 'Vertical' | 'Horizontal' | 'Grid' | 'Off';
export type SmokeColour = 'White' | 'Rainbow' | 'Speed';

export interface SmokeParams {
  rake: RakeMode;
  streams: number;
  /** Stream radius in world units. */
  width: number;
  amount: number;
  colour: SmokeColour;
  /** Break the streams into dashes that show how fast the air moves. */
  pulse: boolean;
  /** Fraction of the smoke that fades per second. */
  fade: number;
}

/** Smoke from the hand-held wand. */
export interface Wand {
  position: Vec3;
  radius: number;
}

/**
 * A wind tunnel on the same atlas-backed 3D grid as the paint solver: inflow at -x, free outflow
 * at +x, slip walls, and a solid object voxelised from its signed distance function every frame.
 */
export class WindSimulator {
  res: Vec3 = [1, 1, 1];
  cols = 1;
  cellSize = 1;
  /** Simulated seconds, used to animate turbulence and pulses. */
  time = 0;
  /** Length of the last step in seconds, needed to turn solver pressure into a pressure coefficient. */
  lastDt = 1 / 60;

  private vel!: PingPong;
  private dye!: PingPong;
  private dyeForward!: RenderTarget;
  private dyeBackward!: RenderTarget;
  private curl!: RenderTarget;
  private divergence!: RenderTarget;
  private pressure!: PingPong;
  private obstacleTarget!: RenderTarget;

  private readonly voxelize: Program;
  private readonly advect: Program;
  private readonly curlProgram: Program;
  private readonly forces: Program;
  private readonly divergenceProgram: Program;
  private readonly pressureProgram: Program;
  private readonly gradient: Program;
  private readonly smoke: Program;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly boxHalf: Vec3,
  ) {
    const make = (src: string, name: string) =>
      new Program(gl, FULLSCREEN_VS, gridSrc + obstacleSrc + tunnelSrc + src, name);
    this.voxelize = make(voxelizeSrc, 'voxelize');
    this.advect = new Program(gl, FULLSCREEN_VS, gridSrc + advectSrc, 'windAdvect');
    this.curlProgram = new Program(gl, FULLSCREEN_VS, gridSrc + curlSrc, 'windCurl');
    this.forces = make(forcesSrc, 'windForces');
    this.divergenceProgram = make(divergenceSrc, 'windDivergence');
    this.pressureProgram = make(pressureSrc, 'windPressure');
    this.gradient = make(gradientSrc, 'windGradient');
    this.smoke = make(smokeSrc, 'windSmoke');
  }

  get dyeTexture(): WebGLTexture {
    return this.dye.read.texture;
  }

  get velocityTexture(): WebGLTexture {
    return this.vel.read.texture;
  }

  get pressureTexture(): WebGLTexture {
    return this.pressure.read.texture;
  }

  /** (Re)allocates the grid with `cellsX` cells along the tunnel. */
  reset(cellsX: number, wind: number): void {
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
    this.dye = new PingPong(gl, w, h, half);
    this.dyeForward = new RenderTarget(gl, w, h, half);
    this.dyeBackward = new RenderTarget(gl, w, h, half);
    this.curl = new RenderTarget(gl, w, h, halfNearest);
    this.divergence = new RenderTarget(gl, w, h, r32f(gl));
    this.pressure = new PingPong(gl, w, h, r32f(gl));
    this.obstacleTarget = new RenderTarget(gl, w, h, halfNearest);
    this.clear(wind);
  }

  /** Clears the smoke and restarts the flow as a uniform stream. */
  clear(wind: number): void {
    const gl = this.gl;
    const zero = [0, 0, 0, 0];
    for (const t of [this.dye.read, this.dye.write, this.pressure.read, this.pressure.write]) {
      t.bind();
      gl.clearBufferfv(gl.COLOR, 0, zero);
    }
    const stream = [wind / this.cellSize, 0, 0, 0];
    for (const t of [this.vel.read, this.vel.write]) {
      t.bind();
      gl.clearBufferfv(gl.COLOR, 0, stream);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  step(dt: number, params: WindParams, smoke: SmokeParams, obstacle: Obstacle, wand: Wand | null): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    this.time += dt;
    this.lastDt = Math.max(dt, 1e-4);

    const toCells = 1 / this.cellSize;
    const wind = params.wind * toCells;
    const grid = (p: Program) => p.use().set('uRes', this.res).set('uCols', this.cols);
    const tunnel = (p: Program) => {
      grid(p)
        .set('uWind', wind)
        .set('uTurbulence', params.turbulence)
        .set('uTime', this.time)
        .texture('uObstacle', this.obstacleTarget.texture);
      obstacle.setUniforms(p);
      return p;
    };

    // 1. Sample the object into the grid.
    this.obstacleTarget.bind();
    const v = obstacle.velocity;
    tunnel(this.voxelize)
      .set('uObsVel', [v.x * toCells, v.y * toCells, v.z * toCells])
      .set('uCellSize', this.cellSize);
    drawFullscreen(gl);

    // 2. Advect velocity by itself.
    this.vel.write.bind();
    grid(this.advect)
      .set('uDt', dt)
      .set('uDissipation', 1)
      .texture('uVel', this.vel.read.texture)
      .texture('uSrc', this.vel.read.texture);
    drawFullscreen(gl);
    this.vel.swap();

    // 3. Vorticity confinement, inflow and the solid object.
    this.curl.bind();
    grid(this.curlProgram).texture('uVel', this.vel.read.texture);
    drawFullscreen(gl);

    this.vel.write.bind();
    tunnel(this.forces)
      .set('uDt', dt)
      .set('uVorticity', params.swirl)
      .texture('uVel', this.vel.read.texture)
      .texture('uCurl', this.curl.texture);
    drawFullscreen(gl);
    this.vel.swap();

    // 4. Pressure projection, warm-started from the previous frame.
    this.divergence.bind();
    tunnel(this.divergenceProgram).texture('uVel', this.vel.read.texture);
    drawFullscreen(gl);

    const pressure = tunnel(this.pressureProgram).texture('uDiv', this.divergence.texture);
    for (let i = 0; i < params.pressureIterations; i++) {
      this.pressure.write.bind();
      pressure.texture('uPressure', this.pressure.read.texture);
      drawFullscreen(gl);
      this.pressure.swap();
    }

    this.vel.write.bind();
    tunnel(this.gradient)
      .texture('uPressure', this.pressure.read.texture)
      .texture('uVel', this.vel.read.texture);
    drawFullscreen(gl);
    this.vel.swap();

    // 5. Smoke: MacCormack advection, then the rake and the wand.
    const advect = grid(this.advect).set('uDissipation', 1).texture('uVel', this.vel.read.texture);
    this.dyeForward.bind();
    advect.set('uDt', dt).texture('uSrc', this.dye.read.texture);
    drawFullscreen(gl);
    this.dyeBackward.bind();
    advect.set('uDt', -dt).texture('uSrc', this.dyeForward.texture);
    drawFullscreen(gl);

    const rake = this.rakeLayout(smoke, obstacle);
    const wandCells = wand
      ? [...this.toCells(wand.position), Math.max(wand.radius * toCells, 1)]
      : [0, 0, 0, 0];
    this.dye.write.bind();
    tunnel(this.smoke)
      .set('uDt', dt)
      .set('uDissipation', Math.exp(-smoke.fade * dt))
      .set('uRakeCount', rake.count)
      .set('uRakeRange', rake.range)
      .set('uRakeRadius', Math.max(smoke.width * toCells, 0.6))
      .set('uRakeAmount', smoke.amount)
      .set('uRainbow', smoke.colour === 'Rainbow' ? 1 : 0)
      .set('uPulse', smoke.pulse ? params.wind / 0.3 : 0)
      .set('uWand', wandCells)
      .set('uWandColor', smoke.colour === 'White' ? [1, 0.55, 0.2] : [1, 1, 1])
      .texture('uVel', this.vel.read.texture)
      .texture('uDye', this.dye.read.texture)
      .texture('uForward', this.dyeForward.texture)
      .texture('uBackward', this.dyeBackward.texture);
    drawFullscreen(gl);
    this.dye.swap();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.depthMask(true);
  }

  /** Where the rake's streams sit on the inlet plane, following the object's height and depth. */
  private rakeLayout(smoke: SmokeParams, obstacle: Obstacle): { count: [number, number]; range: number[] } {
    const [, ry, rz] = this.res;
    const [, oy, oz] = this.toCells([0, obstacle.position.y, obstacle.position.z]);
    const yLo = ry * 0.06;
    const yHi = ry * 0.94;
    const zLo = rz * 0.06;
    const zHi = rz * 0.94;
    const n = Math.max(1, Math.round(smoke.streams));
    switch (smoke.rake) {
      case 'Vertical':
        return { count: [n, 1], range: [yLo, yHi, oz, oz] };
      case 'Horizontal':
        return { count: [1, n], range: [oy, oy, zLo, zHi] };
      case 'Grid': {
        const ny = Math.max(2, Math.round(n / 2));
        const nz = Math.max(2, Math.round((n / 2) * (rz / ry)));
        return { count: [ny, nz], range: [yLo, yHi, zLo, zHi] };
      }
      default:
        return { count: [0, 0], range: [0, 0, 0, 0] };
    }
  }

  private toCells(p: Vec3): Vec3 {
    const s = 1 / this.cellSize;
    const [hx, hy, hz] = this.boxHalf;
    return [(p[0] + hx) * s, (p[1] + hy) * s, (p[2] + hz) * s];
  }

  private disposeTargets(): void {
    this.vel?.dispose();
    this.dye?.dispose();
    this.dyeForward?.dispose();
    this.dyeBackward?.dispose();
    this.curl?.dispose();
    this.divergence?.dispose();
    this.pressure?.dispose();
    this.obstacleTarget?.dispose();
  }
}
