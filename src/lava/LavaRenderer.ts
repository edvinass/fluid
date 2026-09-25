import { drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import { RenderTarget, rgba16f } from '../gl/target';
import type { ViewState } from '../render/camera';
import type { Vec3 } from '../sim/SPHSimulator';
import { MAX_BLOBS, type LavaSimulator } from './LavaSimulator';
import lampSrc from './shaders/lamp.glsl?raw';
import envSrc from './shaders/lavaEnv.glsl?raw';
import backgroundFs from './shaders/background.frag.glsl?raw';
import compositeFs from './shaders/composite.frag.glsl?raw';

export interface LavaLook {
  wax: Vec3;
  liquid: Vec3;
  /** Bulb brightness. */
  brightness: number;
  exposure: number;
}

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
#define MAX_BLOBS ${MAX_BLOBS}
`;

/**
 * The room, table and lamp base are ray marched into a background texture; the composite then ray
 * marches the glass, the glowing liquid and the wax, which is a smooth union of the pool, the blobs
 * and the necks joining new blobs to the pool (so blobs merge and pinch off like real wax).
 */
export class LavaRenderer {
  private readonly background: Program;
  private readonly composite: Program;
  private scene: RenderTarget | null = null;
  private readonly blobData = new Float32Array(MAX_BLOBS * 4);
  private readonly shapeData = new Float32Array(MAX_BLOBS * 4);

  constructor(private readonly gl: WebGL2RenderingContext) {
    const header = HEADER + lampSrc + envSrc;
    this.background = new Program(gl, FULLSCREEN_VS, header + backgroundFs, 'lavaBackground');
    this.composite = new Program(gl, FULLSCREEN_VS, header + compositeFs, 'lavaComposite');
  }

  render(view: ViewState, sim: LavaSimulator, look: LavaLook): void {
    const gl = this.gl;
    if (!this.scene || this.scene.width !== view.width || this.scene.height !== view.height) {
      this.scene?.dispose();
      this.scene = new RenderTarget(gl, view.width, view.height, rgba16f(gl));
    }
    const glow: Vec3 = [look.liquid[0] * look.brightness, look.liquid[1] * look.brightness, look.liquid[2] * look.brightness];
    const lighting = (p: Program) =>
      p
        .use()
        .set('uCameraWorld', view.cameraWorld)
        .set('uTanHalfFov', view.tanHalfFov)
        .set('uAspect', view.aspect)
        .set('uGlowColor', glow)
        .set('uWaxColor', look.wax);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    this.scene.bind();
    lighting(this.background);
    drawFullscreen(gl);

    const blobs = sim.blobs.slice(0, MAX_BLOBS);
    blobs.forEach((b, i) => {
      const s = b.stretch;
      this.blobData.set([b.p[0], b.p[1], b.p[2], sim.radius(b)], i * 4);
      this.shapeData.set([1 / Math.sqrt(s), s, b.temperature, b.neck], i * 4);
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.width, view.height);
    lighting(this.composite)
      .set('uLiquidColor', look.liquid)
      .set('uBrightness', look.brightness)
      .set('uExposure', look.exposure)
      .set('uBlobs', this.blobData)
      .set('uBlobShape', this.shapeData)
      .set('uBlobCount', blobs.length)
      .set('uPool', [sim.poolTop, sim.poolTemperature, sim.time, 0])
      .texture('uScene', this.scene.texture);
    drawFullscreen(gl);
  }
}
