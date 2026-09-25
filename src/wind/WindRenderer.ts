import { drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import { RenderTarget, rgba16f, rgba8 } from '../gl/target';
import type { Theme } from '../paint/PaintRenderer';
import gridSrc from '../paint/shaders/grid.glsl?raw';
import studioSrc from '../paint/shaders/studio.glsl?raw';
import { BoxEdges } from '../render/BoxEdges';
import type { ViewState } from '../render/camera';
import type { Obstacle, Vec3 } from './obstacle';
import type { SmokeColour, WindSimulator } from './WindSimulator';
import obstacleSrc from './shaders/obstacle.glsl?raw';
import backgroundFs from './shaders/windBackground.frag.glsl?raw';
import raymarchFs from './shaders/windRaymarch.frag.glsl?raw';
import compositeFs from './shaders/windComposite.frag.glsl?raw';

export interface WindLook {
  theme: Theme;
  /** Opacity of the smoke. */
  density: number;
  shadow: number;
  colour: SmokeColour;
  /** Colour the object by surface pressure. */
  pressure: boolean;
  /** Resolution of the smoke raymarch relative to the screen. */
  renderScale: number;
}

const SUN_DIR: Vec3 = (() => {
  const v: Vec3 = [0.35, 0.85, 0.4];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

const OBJECT_COLOR: Vec3 = [0.72, 0.74, 0.78];

/** Studio backdrop, the glass tunnel, volumetric smoke and the solid object. */
export class WindRenderer {
  private readonly background: Program;
  private readonly raymarch: Program;
  private readonly composite: Program;
  private readonly edges: BoxEdges;
  private scene: RenderTarget | null = null;
  private volume: RenderTarget | null = null;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly boxHalf: Vec3,
  ) {
    const make = (fs: string, name: string) =>
      new Program(gl, FULLSCREEN_VS, gridSrc + studioSrc + obstacleSrc + fs, name);
    this.background = make(backgroundFs, 'windBackground');
    this.raymarch = make(raymarchFs, 'windRaymarch');
    this.composite = make(compositeFs, 'windComposite');
    this.edges = new BoxEdges(gl, boxHalf);
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

  render(view: ViewState, sim: WindSimulator, obstacle: Obstacle, look: WindLook, wind: number, frame: number): void {
    const gl = this.gl;
    this.ensureTargets(view.width, view.height, look.renderScale);
    const scene = this.scene!;
    const volume = this.volume!;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);

    const theme = look.theme;
    const common = (p: Program) => {
      p.use()
        .set('uRes', sim.res)
        .set('uCols', sim.cols)
        .set('uCameraWorld', view.cameraWorld)
        .set('uTanHalfFov', view.tanHalfFov)
        .set('uAspect', view.aspect)
        .set('uSkyTop', theme.skyTop)
        .set('uSkyHorizon', theme.skyHorizon)
        .set('uFloorColor', theme.floor)
        .set('uSunDir', SUN_DIR)
        .set('uFloorY', -this.boxHalf[1])
        .set('uBoxHalf', this.boxHalf)
        .set('uPaintDensity', look.density)
        .set('uAmbient', theme.ambient)
        .set('uSunColor', theme.sunColor)
        .texture('uDye', sim.dyeTexture);
      obstacle.setUniforms(p);
      return p;
    };

    // Backdrop and floor, plus the tunnel edges behind the smoke.
    scene.bind();
    const f = theme.floor;
    common(this.background)
      .set('uTunnelFloor', [f[0] * 0.82, f[1] * 0.83, f[2] * 0.86])
      .set('uGridColor', [f[0] * 0.55, f[1] * 0.58, f[2] * 0.64]);
    drawFullscreen(gl);
    this.edges.draw(view, theme.edgeColor, false);

    // Smoke at reduced resolution.
    volume.bind();
    common(this.raymarch)
      .set('uStep', sim.cellSize * 0.9)
      .set('uFrame', frame % 1000)
      .set('uShadow', look.shadow)
      .set('uSpeedColour', look.colour === 'Speed' ? 1 : 0)
      .set('uWind', Math.max(wind, 0.05) / sim.cellSize)
      .texture('uVel', sim.velocityTexture);
    drawFullscreen(gl);

    // Object, smoke and glass on screen, then the tunnel edges in front.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.width, view.height);
    const u = Math.max(wind, 0.05) / sim.cellSize;
    common(this.composite)
      .set('uObjectColor', OBJECT_COLOR)
      .set('uPressureColour', look.pressure ? 1 : 0)
      .set('uCpScale', 1 / (sim.lastDt * 0.5 * u * u))
      .set('uCellSize', sim.cellSize)
      .texture('uScene', scene.texture)
      .texture('uVolume', volume.texture)
      .texture('uPressure', sim.pressureTexture);
    drawFullscreen(gl);
    this.edges.draw(view, theme.edgeColor, true);
    gl.depthMask(true);
  }
}
