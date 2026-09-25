import { drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import { RenderTarget, rgba16f, rgba8 } from '../gl/target';
import { BoxEdges } from '../render/BoxEdges';
import type { ViewState } from '../render/camera';
import type { PaintSimulator, Vec3 } from './PaintSimulator';
import gridSrc from './shaders/grid.glsl?raw';
import studioSrc from './shaders/studio.glsl?raw';
import backgroundFs from './shaders/background.frag.glsl?raw';
import raymarchFs from './shaders/raymarch.frag.glsl?raw';
import compositeFs from './shaders/composite.frag.glsl?raw';

export interface Theme {
  skyTop: Vec3;
  skyHorizon: Vec3;
  floor: Vec3;
  ambient: Vec3;
  sunColor: Vec3;
  waterAbsorb: Vec3;
  edgeColor: [number, number, number, number];
  bodyClass: string;
}

export const THEMES: Record<'light' | 'dark', Theme> = {
  light: {
    skyTop: [0.97, 0.97, 0.98],
    skyHorizon: [0.86, 0.87, 0.9],
    floor: [0.9, 0.9, 0.91],
    ambient: [0.55, 0.57, 0.6],
    sunColor: [0.75, 0.72, 0.68],
    waterAbsorb: [0.07, 0.03, 0.022],
    edgeColor: [0.35, 0.42, 0.5, 0.55],
    bodyClass: 'theme-light',
  },
  dark: {
    skyTop: [0.04, 0.06, 0.1],
    skyHorizon: [0.2, 0.24, 0.3],
    floor: [0.13, 0.14, 0.16],
    ambient: [0.3, 0.33, 0.38],
    sunColor: [1.0, 0.95, 0.88],
    waterAbsorb: [0.12, 0.05, 0.03],
    edgeColor: [0.8, 0.9, 1.0, 0.45],
    bodyClass: '',
  },
};

export interface PaintLook {
  theme: Theme;
  /** Opacity of the paint. */
  density: number;
  /** Strength of paint self-shadowing. */
  shadow: number;
  /** Resolution of the volume raymarch relative to the screen. */
  renderScale: number;
}

const SUN_DIR: Vec3 = (() => {
  const v: Vec3 = [0.35, 0.85, 0.4];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

/** Studio backdrop, volumetric paint and the glass tank. */
export class PaintRenderer {
  private readonly background: Program;
  private readonly raymarch: Program;
  private readonly composite: Program;
  private readonly edges: BoxEdges;
  private scene: RenderTarget | null = null;
  private volume: RenderTarget | null = null;
  readonly floorY: number;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly boxHalf: Vec3,
  ) {
    const make = (fs: string, name: string) => new Program(gl, FULLSCREEN_VS, gridSrc + studioSrc + fs, name);
    this.background = make(backgroundFs, 'paintBackground');
    this.raymarch = make(raymarchFs, 'raymarch');
    this.composite = make(compositeFs, 'paintComposite');
    this.edges = new BoxEdges(gl, boxHalf);
    this.floorY = -boxHalf[1] - 0.004;
  }

  private ensureTargets(width: number, height: number, scale: number): void {
    const gl = this.gl;
    if (!this.scene || this.scene.width !== width || this.scene.height !== height) {
      this.scene?.dispose();
      this.scene = new RenderTarget(gl, width, height, rgba8(gl));
    }
    const vw = Math.max(1, Math.round(width * scale));
    const vh = Math.max(1, Math.round(height * scale));
    if (!this.volume || this.volume.width !== vw || this.volume.height !== vh) {
      this.volume?.dispose();
      this.volume = new RenderTarget(gl, vw, vh, rgba16f(gl));
    }
  }

  render(view: ViewState, sim: PaintSimulator, look: PaintLook, frame: number): void {
    const gl = this.gl;
    this.ensureTargets(view.width, view.height, look.renderScale);
    const scene = this.scene!;
    const volume = this.volume!;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);

    const common = (p: Program) =>
      p
        .use()
        .set('uRes', sim.res)
        .set('uCols', sim.cols)
        .set('uCameraWorld', view.cameraWorld)
        .set('uTanHalfFov', view.tanHalfFov)
        .set('uAspect', view.aspect)
        .set('uSkyTop', look.theme.skyTop)
        .set('uSkyHorizon', look.theme.skyHorizon)
        .set('uFloorColor', look.theme.floor)
        .set('uSunDir', SUN_DIR)
        .set('uFloorY', this.floorY)
        .set('uBoxHalf', this.boxHalf)
        .set('uPaintDensity', look.density)
        .texture('uDye', sim.dyeTexture);

    // Backdrop with paint-tinted floor shadows, plus the tank edges behind the water.
    scene.bind();
    common(this.background);
    drawFullscreen(gl);
    this.edges.draw(view, look.theme.edgeColor, false);

    // Paint volume at reduced resolution.
    volume.bind();
    common(this.raymarch)
      .set('uStep', sim.cellSize * 0.9)
      .set('uFrame', frame % 1000)
      .set('uAmbient', look.theme.ambient)
      .set('uSunColor', look.theme.sunColor)
      .set('uShadow', look.shadow);
    drawFullscreen(gl);

    // Combine on screen, then the tank edges in front.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.width, view.height);
    common(this.composite)
      .set('uWaterAbsorb', look.theme.waterAbsorb)
      .texture('uScene', scene.texture)
      .texture('uVolume', volume.texture);
    drawFullscreen(gl);
    this.edges.draw(view, look.theme.edgeColor, true);
    gl.depthMask(true);
  }
}
