import { drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import { RenderTarget, rgba16f } from '../gl/target';
import gridSrc from '../paint/shaders/grid.glsl?raw';
import type { ViewState } from '../render/camera';
import type { FireSimulator, Vec3 } from './FireSimulator';
import sceneSrc from './shaders/fireScene.glsl?raw';
import studioSrc from './shaders/fireStudio.glsl?raw';
import backgroundFs from './shaders/fireBackground.frag.glsl?raw';
import raymarchFs from './shaders/fireRaymarch.frag.glsl?raw';
import compositeFs from './shaders/fireComposite.frag.glsl?raw';
import bloomFs from './shaders/bloom.frag.glsl?raw';

export interface FireLook {
  /** Flame-test tint, or null for a natural flame. */
  tint: Vec3 | null;
  brightness: number;
  smoke: number;
  bloom: number;
  exposure: number;
  /** Resolution of the volume raymarch relative to the screen. */
  renderScale: number;
}

const BLOOM_LEVELS = 3;
const LIGHT_STRENGTH = 10;

/** Night backdrop, glowing flames and smoke, the scenery they light, and bloom. */
export class FireRenderer {
  private readonly background: Program;
  private readonly raymarch: Program;
  private readonly composite: Program;
  private readonly bloom: Program;
  private scene: RenderTarget | null = null;
  private volume: RenderTarget | null = null;
  /** Per level: [downsampled, blurred horizontally]; the vertical blur writes back into the first. */
  private bloomTargets: [RenderTarget, RenderTarget][] = [];

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly boxHalf: Vec3,
  ) {
    const make = (fs: string, name: string) => new Program(gl, FULLSCREEN_VS, gridSrc + sceneSrc + studioSrc + fs, name);
    this.background = make(backgroundFs, 'fireBackground');
    this.raymarch = make(raymarchFs, 'fireRaymarch');
    this.composite = make(compositeFs, 'fireComposite');
    this.bloom = new Program(gl, FULLSCREEN_VS, bloomFs, 'bloom');
  }

  private ensureTargets(width: number, height: number, scale: number): void {
    const gl = this.gl;
    if (!this.scene || this.scene.width !== width || this.scene.height !== height) {
      this.scene?.dispose();
      this.scene = new RenderTarget(gl, width, height, rgba16f(gl));
    }
    const vw = Math.max(1, Math.round(width * scale));
    const vh = Math.max(1, Math.round(height * scale));
    if (!this.volume || this.volume.width !== vw || this.volume.height !== vh) {
      this.volume?.dispose();
      this.volume = new RenderTarget(gl, vw, vh, rgba16f(gl));
    }
    // Bloom levels at 1/4, 1/8 and 1/16 of the screen, independent of the raymarch resolution.
    const bw = Math.max(1, Math.round(width / 4));
    const bh = Math.max(1, Math.round(height / 4));
    if (!this.bloomTargets.length || this.bloomTargets[0][0].width !== bw || this.bloomTargets[0][0].height !== bh) {
      for (const [a, b] of this.bloomTargets) {
        a.dispose();
        b.dispose();
      }
      this.bloomTargets = [];
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        const w = Math.max(1, bw >> i);
        const h = Math.max(1, bh >> i);
        this.bloomTargets.push([new RenderTarget(gl, w, h, rgba16f(gl)), new RenderTarget(gl, w, h, rgba16f(gl))]);
      }
    }
  }

  render(view: ViewState, sim: FireSimulator, look: FireLook, frame: number): void {
    const gl = this.gl;
    this.ensureTargets(view.width, view.height, look.renderScale);
    const scene = this.scene!;
    const volume = this.volume!;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);

    const lightScale = LIGHT_STRENGTH * sim.cellSize ** 3;
    const common = (p: Program) =>
      p
        .use()
        .set('uRes', sim.res)
        .set('uCols', sim.cols)
        .set('uCameraWorld', view.cameraWorld)
        .set('uTanHalfFov', view.tanHalfFov)
        .set('uAspect', view.aspect)
        .set('uBoxHalf', this.boxHalf)
        .set('uCellSize', sim.cellSize)
        .set('uScene', sim.scene)
        .set('uGround', -this.boxHalf[1])
        .set('uLightScale', lightScale)
        .set('uFlameTint', look.tint ?? [1, 1, 1])
        .set('uTintAmount', look.tint ? 1 : 0)
        .texture('uState', sim.stateTexture)
        .texture('uLight', sim.lightTexture);

    scene.bind();
    common(this.background);
    drawFullscreen(gl);

    volume.bind();
    common(this.raymarch)
      .set('uStep', sim.cellSize * 0.9)
      .set('uFrame', frame % 1000)
      .set('uBrightness', look.brightness)
      .set('uSmokeDensity', look.smoke);
    drawFullscreen(gl);

    this.renderBloom(volume);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.width, view.height);
    const [b0, b1, b2] = this.bloomTargets;
    common(this.composite)
      .set('uBloom', look.bloom)
      .set('uExposure', look.exposure)
      .texture('uBackdrop', scene.texture)
      .texture('uVolume', volume.texture)
      .texture('uBloom0', b0[0].texture)
      .texture('uBloom1', b1[0].texture)
      .texture('uBloom2', b2[0].texture);
    drawFullscreen(gl);
    gl.depthMask(true);
  }

  private renderBloom(source: RenderTarget): void {
    const gl = this.gl;
    const p = this.bloom.use();
    let src = source;
    for (const [level, temp] of this.bloomTargets) {
      level.bind();
      p.set('uDir', [0, 0]).set('uTexel', [1 / src.width, 1 / src.height]).texture('uSrc', src.texture);
      drawFullscreen(gl);
      const texel = [1 / level.width, 1 / level.height];
      temp.bind();
      p.set('uDir', [1, 0]).set('uTexel', texel).texture('uSrc', level.texture);
      drawFullscreen(gl);
      level.bind();
      p.set('uDir', [0, 1]).set('uTexel', texel).texture('uSrc', temp.texture);
      drawFullscreen(gl);
      src = level;
    }
  }
}
