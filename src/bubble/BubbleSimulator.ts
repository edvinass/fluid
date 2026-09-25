import { CubePingPong, CubeTarget } from '../gl/cube';
import { drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import { r32f, rgba16f, type TextureFormat } from '../gl/target';
import sphereSrc from './shaders/sphere.glsl?raw';
import advectVelocitySrc from './shaders/advectVelocity.glsl?raw';
import curlSrc from './shaders/curl.glsl?raw';
import forcesSrc from './shaders/forces.glsl?raw';
import divergenceSrc from './shaders/divergence.glsl?raw';
import pressureSrc from './shaders/pressure.glsl?raw';
import gradientSrc from './shaders/gradient.glsl?raw';
import advectFilmSrc from './shaders/advectFilm.glsl?raw';
import filmCorrectSrc from './shaders/filmCorrect.glsl?raw';
import filmInitSrc from './shaders/filmInit.glsl?raw';

export type Vec3 = [number, number, number];

export interface BubbleParams {
  /** Thickness of a new bubble's film, micrometres. */
  thickness: number;
  /** How strongly thickness differences drive the flow (thick film sinks, thin film rises). */
  convection: number;
  swirl: number;
  turbulence: number;
  /** Rate at which gravity drains liquid from the top towards the bottom. */
  drainage: number;
  evaporation: number;
  /** New thin patches per second rising from the bottom. */
  plumes: number;
  drag: number;
  timeScale: number;
  pressureIterations: number;
  paused: boolean;
}

/** The user's finger dragging the film along. */
export interface Stir {
  /** Unit direction from the bubble's centre. */
  point: Vec3;
  /** Angular radius, radians. */
  radius: number;
  /** Tangential velocity, radians per second. */
  velocity: Vec3;
}

interface Plume {
  point: Vec3;
  radius: number;
  strength: number;
  age: number;
  life: number;
}

const MAX_STIRS = 2;
const MAX_PLUMES = 4;

/**
 * A soap film on a sphere: an incompressible 2D flow over the surface, stored in cube maps, which
 * carries the film thickness around. Gravity drains the film and makes thickness differences
 * convect, which produces the swirling interference colours.
 */
export class BubbleSimulator {
  size = 0;
  time = 0;
  /** Mean film thickness, micrometres (drainage moves liquid around, evaporation removes it). */
  meanThickness = 0;

  private vel!: CubePingPong;
  private film!: CubePingPong;
  private forward!: CubeTarget;
  private backward!: CubeTarget;
  private curl!: CubeTarget;
  private divergence!: CubeTarget;
  private pressure!: CubePingPong;
  private plumes: Plume[] = [];
  private plumeTimer = 0;

  private readonly advectVelocity: Program;
  private readonly curlProgram: Program;
  private readonly forces: Program;
  private readonly divergenceProgram: Program;
  private readonly pressureProgram: Program;
  private readonly gradient: Program;
  private readonly advectFilm: Program;
  private readonly filmCorrect: Program;
  private readonly filmInit: Program;

  private readonly stirPos = new Float32Array(MAX_STIRS * 4);
  private readonly stirVel = new Float32Array(MAX_STIRS * 3);
  private readonly plumePos = new Float32Array(MAX_PLUMES * 4);
  private readonly plumeThin = new Float32Array(MAX_PLUMES);

  constructor(private readonly gl: WebGL2RenderingContext) {
    const make = (src: string, name: string) => new Program(gl, FULLSCREEN_VS, sphereSrc + src, name);
    this.advectVelocity = make(advectVelocitySrc, 'bubbleAdvectVelocity');
    this.curlProgram = make(curlSrc, 'bubbleCurl');
    this.forces = make(forcesSrc, 'bubbleForces');
    this.divergenceProgram = make(divergenceSrc, 'bubbleDivergence');
    this.pressureProgram = make(pressureSrc, 'bubblePressure');
    this.gradient = make(gradientSrc, 'bubbleGradient');
    this.advectFilm = make(advectFilmSrc, 'bubbleAdvectFilm');
    this.filmCorrect = make(filmCorrectSrc, 'bubbleFilmCorrect');
    this.filmInit = make(filmInitSrc, 'bubbleFilmInit');
  }

  get filmTexture(): WebGLTexture {
    return this.film.read.texture;
  }

  /** (Re)allocates the fields with `size` texels along each cube face, keeping nothing. */
  reset(size: number, thickness: number): void {
    this.disposeTargets();
    const gl = this.gl;
    this.size = size;
    const half = rgba16f(gl);
    const exact: TextureFormat = r32f(gl);
    this.vel = new CubePingPong(gl, size, half);
    this.film = new CubePingPong(gl, size, half);
    this.forward = new CubeTarget(gl, size, half);
    this.backward = new CubeTarget(gl, size, half);
    this.curl = new CubeTarget(gl, size, { ...half, filter: gl.NEAREST });
    this.divergence = new CubeTarget(gl, size, exact);
    this.pressure = new CubePingPong(gl, size, exact);
    this.newBubble(thickness);
  }

  /** A fresh film: still, with gentle random thickness variations. */
  newBubble(thickness: number): void {
    const gl = this.gl;
    for (const t of [this.vel.read, this.vel.write, this.pressure.read, this.pressure.write]) {
      for (let face = 0; face < 6; face++) {
        t.bindFace(face);
        gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      }
    }
    this.filmInit.use().set('uThickness', thickness).set('uSeed', Math.random() * 10);
    this.drawFaces(this.film.write, this.filmInit);
    this.film.swap();
    this.meanThickness = thickness;
    this.plumes = [];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  step(dt: number, params: BubbleParams, stirs: Stir[]): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    this.time += dt;
    this.updatePlumes(dt, params.plumes);
    this.packStirs(stirs);

    // 1. Carry the flow along itself.
    this.advectVelocity.use().set('uDt', dt).texture('uVel', this.vel.read.texture);
    this.drawFaces(this.vel.write, this.advectVelocity);
    this.vel.swap();

    // 2. Buoyancy, vorticity confinement, breeze and the user's stirring.
    this.curlProgram.use().texture('uVel', this.vel.read.texture);
    this.drawFaces(this.curl, this.curlProgram);

    this.forces
      .use()
      .set('uDt', dt)
      .set('uVorticity', params.swirl)
      .set('uConvection', params.convection)
      .set('uMeanThickness', this.meanThickness)
      .set('uTurbulence', params.turbulence)
      .set('uDrag', params.drag)
      .set('uStirCount', Math.min(stirs.length, MAX_STIRS))
      .set('uStirPos', this.stirPos)
      .set('uStirVel', this.stirVel)
      .texture('uVel', this.vel.read.texture)
      .texture('uCurl', this.curl.texture)
      .texture('uFilm', this.film.read.texture);
    this.drawFaces(this.vel.write, this.forces);
    this.vel.swap();

    // 3. Keep the film incompressible, warm-starting the pressure from the last step.
    this.divergenceProgram.use().texture('uVel', this.vel.read.texture);
    this.drawFaces(this.divergence, this.divergenceProgram);
    const pressure = this.pressureProgram.use().texture('uDiv', this.divergence.texture);
    for (let i = 0; i < params.pressureIterations; i++) {
      pressure.texture('uPressure', this.pressure.read.texture);
      this.drawFaces(this.pressure.write, pressure);
      this.pressure.swap();
    }
    this.gradient.use().texture('uPressure', this.pressure.read.texture).texture('uVel', this.vel.read.texture);
    this.drawFaces(this.vel.write, this.gradient);
    this.vel.swap();

    // 4. Carry the thickness along (MacCormack), then drain and thin it.
    const advect = this.advectFilm.use().texture('uVel', this.vel.read.texture);
    advect.set('uDt', dt).texture('uSrc', this.film.read.texture);
    this.drawFaces(this.forward, advect);
    advect.set('uDt', -dt).texture('uSrc', this.forward.texture);
    this.drawFaces(this.backward, advect);

    this.filmCorrect
      .use()
      .set('uDt', dt)
      .set('uDrain', params.drainage)
      .set('uEvaporation', params.evaporation)
      .set('uPlumeCount', this.plumes.length)
      .set('uPlumePos', this.plumePos)
      .set('uPlumeThin', this.plumeThin)
      .texture('uVel', this.vel.read.texture)
      .texture('uFilm', this.film.read.texture)
      .texture('uForward', this.forward.texture)
      .texture('uBackward', this.backward.texture);
    this.drawFaces(this.film.write, this.filmCorrect);
    this.film.swap();
    this.meanThickness *= Math.exp(-params.evaporation * dt);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.depthMask(true);
  }

  /** Runs a pass over all six faces; the program must already be in use with its inputs bound. */
  private drawFaces(target: CubeTarget, program: Program): void {
    for (let face = 0; face < 6; face++) {
      target.bindFace(face);
      program.set('uFace', face).set('uSize', this.size).set('uTime', this.time);
      drawFullscreen(this.gl);
    }
  }

  /** Thin patches appear near the bottom now and then and rise through the thicker film. */
  private updatePlumes(dt: number, rate: number): void {
    for (const p of this.plumes) p.age += dt;
    this.plumes = this.plumes.filter((p) => p.age < p.life);
    this.plumeTimer -= dt * rate;
    if (this.plumeTimer <= 0 && this.plumes.length < MAX_PLUMES && rate > 0) {
      this.plumeTimer = 0.5 + Math.random();
      const angle = Math.random() * Math.PI * 2;
      const y = -0.72 - Math.random() * 0.22;
      const r = Math.sqrt(1 - y * y);
      this.plumes.push({
        point: [Math.cos(angle) * r, y, Math.sin(angle) * r],
        radius: 0.06 + Math.random() * 0.08,
        strength: 0.6 + Math.random() * 0.8,
        age: 0,
        life: 1 + Math.random() * 1.5,
      });
    }
    this.plumes.forEach((p, i) => {
      this.plumePos.set([...p.point, p.radius], i * 4);
      this.plumeThin[i] = p.strength * Math.sin((Math.PI * p.age) / p.life);
    });
  }

  private packStirs(stirs: Stir[]): void {
    stirs.slice(0, MAX_STIRS).forEach((s, i) => {
      this.stirPos.set([...s.point, s.radius], i * 4);
      this.stirVel.set(s.velocity, i * 3);
    });
  }

  private disposeTargets(): void {
    this.vel?.dispose();
    this.film?.dispose();
    this.forward?.dispose();
    this.backward?.dispose();
    this.curl?.dispose();
    this.divergence?.dispose();
    this.pressure?.dispose();
  }
}
