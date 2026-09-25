import { drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import { PingPong, RenderTarget, r32f, rgba16f, type TextureFormat } from '../gl/target';
import gridSrc from './shaders/grid.glsl?raw';
import advectSrc from './shaders/advect.glsl?raw';
import dyeCorrectSrc from './shaders/dyeCorrect.glsl?raw';
import curlSrc from './shaders/curl.glsl?raw';
import forcesSrc from './shaders/forces.glsl?raw';
import divergenceSrc from './shaders/divergence.glsl?raw';
import pressureSrc from './shaders/pressure.glsl?raw';
import gradientSrc from './shaders/gradient.glsl?raw';

export type Vec3 = [number, number, number];

/** A pour stream or stirring brush, in world units relative to the tank centre. */
export interface PaintSource {
  position: Vec3;
  velocity: Vec3;
  color: Vec3;
  /** Paint concentration added per second at the centre (0 for a stir-only source). */
  amount: number;
  radius: number;
  /** Vertical stretch of the source shape, so pour streams are taller than they are wide. */
  stretch: number;
}

export interface PaintParams {
  timeScale: number;
  /** Strength of vorticity confinement. */
  swirl: number;
  /** How quickly paint sinks, in world units / s^2 per unit concentration. */
  weight: number;
  /** Fraction of the paint that fades per second. */
  fade: number;
  /** Velocity damping per second. */
  drag: number;
  pressureIterations: number;
  paused: boolean;
}

export const MAX_SOURCES = 4;

export interface GridLayout {
  res: Vec3;
  cols: number;
  cellSize: number;
  /** Size of the 2D atlas texture holding all z-slices. */
  width: number;
  height: number;
}

/** Grid dimensions and atlas layout for a tank with `cellsX` cubic cells across its width. */
export function gridLayout(boxHalf: Vec3, cellsX: number): GridLayout {
  const [hx, hy, hz] = boxHalf;
  const cellSize = (2 * hx) / cellsX;
  const res: Vec3 = [cellsX, Math.round((2 * hy) / cellSize), Math.round((2 * hz) / cellSize)];
  const cols = Math.ceil(Math.sqrt(res[2]));
  const rows = Math.ceil(res[2] / cols);
  return { res, cols, cellSize, width: cols * res[0], height: rows * res[1] };
}

/**
 * Incompressible 3D fluid on a uniform grid (stable fluids), carrying coloured paint. Volumes
 * are stored as 2D atlases of z-slices so each solver step is a single full-screen pass.
 */
export class PaintSimulator {
  res: Vec3 = [1, 1, 1];
  cols = 1;
  cellSize = 1;

  private vel!: PingPong;
  private dye!: PingPong;
  private dyeForward!: RenderTarget;
  private dyeBackward!: RenderTarget;
  private curl!: RenderTarget;
  private divergence!: RenderTarget;
  private pressure!: PingPong;

  private readonly advect: Program;
  private readonly dyeCorrect: Program;
  private readonly curlProgram: Program;
  private readonly forces: Program;
  private readonly divergenceProgram: Program;
  private readonly pressureProgram: Program;
  private readonly gradient: Program;

  private readonly sourceData = {
    pos: new Float32Array(MAX_SOURCES * 3),
    vel: new Float32Array(MAX_SOURCES * 3),
    color: new Float32Array(MAX_SOURCES * 4),
    shape: new Float32Array(MAX_SOURCES * 2),
  };
  private sourceCount = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly boxHalf: Vec3,
  ) {
    const make = (src: string, name: string) => new Program(gl, FULLSCREEN_VS, gridSrc + src, name);
    this.advect = make(advectSrc, 'advect');
    this.dyeCorrect = make(dyeCorrectSrc, 'dyeCorrect');
    this.curlProgram = make(curlSrc, 'curl');
    this.forces = make(forcesSrc, 'forces');
    this.divergenceProgram = make(divergenceSrc, 'divergence');
    this.pressureProgram = make(pressureSrc, 'pressure');
    this.gradient = make(gradientSrc, 'gradient');
  }

  get dyeTexture(): WebGLTexture {
    return this.dye.read.texture;
  }

  /** (Re)allocates the grid with `cellsX` cells across the tank width. */
  reset(cellsX: number): void {
    const layout = gridLayout(this.boxHalf, cellsX);
    this.cellSize = layout.cellSize;
    this.res = layout.res;
    this.cols = layout.cols;
    const w = layout.width;
    const h = layout.height;

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
    this.clear();
  }

  /** Removes all paint and brings the water to rest. */
  clear(): void {
    const gl = this.gl;
    const zero = [0, 0, 0, 0];
    for (const t of [this.vel.read, this.vel.write, this.dye.read, this.dye.write, this.pressure.read, this.pressure.write]) {
      t.bind();
      gl.clearBufferfv(gl.COLOR, 0, zero);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  step(dt: number, params: PaintParams, sources: PaintSource[]): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    this.packSources(sources);

    const toCells = 1 / this.cellSize;
    const grid = (p: Program) =>
      p
        .use()
        .set('uRes', this.res)
        .set('uCols', this.cols)
        .set('uSourceCount', this.sourceCount)
        .set('uSourcePos', this.sourceData.pos)
        .set('uSourceVel', this.sourceData.vel)
        .set('uSourceColor', this.sourceData.color)
        .set('uSourceShape', this.sourceData.shape);

    // 1. Advect velocity by itself.
    this.vel.write.bind();
    grid(this.advect)
      .set('uDt', dt)
      .set('uDissipation', 1)
      .texture('uVel', this.vel.read.texture)
      .texture('uSrc', this.vel.read.texture);
    drawFullscreen(gl);
    this.vel.swap();

    // 2. Vorticity, then 3. confinement, buoyancy and source velocities.
    this.curl.bind();
    grid(this.curlProgram).texture('uVel', this.vel.read.texture);
    drawFullscreen(gl);

    this.vel.write.bind();
    grid(this.forces)
      .set('uDt', dt)
      .set('uVorticity', params.swirl)
      .set('uSink', params.weight * toCells)
      .texture('uVel', this.vel.read.texture)
      .texture('uCurl', this.curl.texture)
      .texture('uDye', this.dye.read.texture);
    drawFullscreen(gl);
    this.vel.swap();

    // 4. Pressure projection (warm-started from last frame's pressure).
    this.divergence.bind();
    grid(this.divergenceProgram).texture('uVel', this.vel.read.texture);
    drawFullscreen(gl);

    const pressure = grid(this.pressureProgram).texture('uDiv', this.divergence.texture);
    for (let i = 0; i < params.pressureIterations; i++) {
      this.pressure.write.bind();
      pressure.texture('uPressure', this.pressure.read.texture);
      drawFullscreen(gl);
      this.pressure.swap();
    }

    this.vel.write.bind();
    grid(this.gradient)
      .set('uDissipation', Math.exp(-params.drag * dt))
      .texture('uPressure', this.pressure.read.texture)
      .texture('uVel', this.vel.read.texture);
    drawFullscreen(gl);
    this.vel.swap();

    // 5. Advect paint with MacCormack: forward, backward, then correct and inject.
    const advect = grid(this.advect).set('uDissipation', 1).texture('uVel', this.vel.read.texture);
    this.dyeForward.bind();
    advect.set('uDt', dt).texture('uSrc', this.dye.read.texture);
    drawFullscreen(gl);
    this.dyeBackward.bind();
    advect.set('uDt', -dt).texture('uSrc', this.dyeForward.texture);
    drawFullscreen(gl);

    this.dye.write.bind();
    grid(this.dyeCorrect)
      .set('uDt', dt)
      .set('uDissipation', Math.exp(-params.fade * dt))
      .texture('uVel', this.vel.read.texture)
      .texture('uDye', this.dye.read.texture)
      .texture('uForward', this.dyeForward.texture)
      .texture('uBackward', this.dyeBackward.texture);
    drawFullscreen(gl);
    this.dye.swap();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.depthMask(true);
  }

  private packSources(sources: PaintSource[]): void {
    const [hx, hy, hz] = this.boxHalf;
    const s = 1 / this.cellSize;
    const d = this.sourceData;
    this.sourceCount = Math.min(sources.length, MAX_SOURCES);
    for (let i = 0; i < this.sourceCount; i++) {
      const src = sources[i];
      d.pos.set([(src.position[0] + hx) * s, (src.position[1] + hy) * s, (src.position[2] + hz) * s], i * 3);
      d.vel.set([src.velocity[0] * s, src.velocity[1] * s, src.velocity[2] * s], i * 3);
      d.color.set([src.color[0], src.color[1], src.color[2], src.amount], i * 4);
      d.shape.set([Math.max(src.radius * s, 0.75), src.stretch], i * 2);
    }
  }

  private disposeTargets(): void {
    this.vel?.dispose();
    this.dye?.dispose();
    this.dyeForward?.dispose();
    this.dyeBackward?.dispose();
    this.curl?.dispose();
    this.divergence?.dispose();
    this.pressure?.dispose();
  }
}
