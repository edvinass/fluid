import { bindEmptyVao, drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import { RenderTarget, r16f, r32f, rgba16f } from '../gl/target';
import type { ViewState } from '../render/camera';
import splatVs from '../render/shaders/splat.vert.glsl?raw';
import splatDepthFs from '../render/shaders/splatDepth.frag.glsl?raw';
import splatThicknessFs from '../render/shaders/splatThickness.frag.glsl?raw';
import blurFs from '../render/shaders/blur.frag.glsl?raw';
import type { HoneySimulator, SceneState, Vec3 } from './HoneySimulator';
import sceneSrc from './shaders/honeyScene.glsl?raw';
import envSrc from './shaders/honeyEnv.glsl?raw';
import backgroundFs from './shaders/background.frag.glsl?raw';
import compositeFs from './shaders/composite.frag.glsl?raw';

export interface HoneyLook {
  absorption: Vec3;
  scatter: Vec3;
  refraction: number;
  smoothing: number;
  exposure: number;
  /** Linear colour of the liquid coating the dipper, and how much of it there is (0 to 1). */
  coat: [number, number, number, number];
}

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/**
 * The kitchen table and dishes are ray marched; the liquid is drawn with screen-space fluid
 * rendering (smoothed particle depth, thickness for absorption), like the water page.
 */
export class HoneyRenderer {
  private readonly background: Program;
  private readonly depthProgram: Program;
  private readonly thicknessProgram: Program;
  private readonly blurProgram: Program;
  private readonly composite: Program;

  private scene: RenderTarget | null = null;
  private depth: RenderTarget | null = null;
  private depthTemp: RenderTarget | null = null;
  private thickness: RenderTarget | null = null;
  private thicknessTemp: RenderTarget | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.background = new Program(gl, FULLSCREEN_VS, HEADER + sceneSrc + envSrc + backgroundFs, 'honeyBackground');
    this.depthProgram = new Program(gl, splatVs, splatDepthFs, 'honeySplatDepth');
    this.thicknessProgram = new Program(gl, splatVs, splatThicknessFs, 'honeySplatThickness');
    this.blurProgram = new Program(gl, FULLSCREEN_VS, blurFs, 'honeyBlur');
    this.composite = new Program(gl, FULLSCREEN_VS, HEADER + envSrc + compositeFs, 'honeyComposite');
  }

  private ensureTargets(width: number, height: number): void {
    if (this.scene && this.scene.width === width && this.scene.height === height) return;
    this.disposeTargets();
    const gl = this.gl;
    const hw = Math.max(1, width >> 1);
    const hh = Math.max(1, height >> 1);
    this.scene = new RenderTarget(gl, width, height, rgba16f(gl));
    this.depth = new RenderTarget(gl, width, height, r32f(gl), true);
    this.depthTemp = new RenderTarget(gl, width, height, r32f(gl));
    this.thickness = new RenderTarget(gl, hw, hh, r16f(gl));
    this.thicknessTemp = new RenderTarget(gl, hw, hh, r16f(gl));
  }

  render(view: ViewState, sim: HoneySimulator, scene: SceneState, look: HoneyLook): void {
    const gl = this.gl;
    this.ensureTargets(view.width, view.height);
    const depth = this.depth!;
    const depthTemp = this.depthTemp!;
    const thickness = this.thickness!;
    const thicknessTemp = this.thicknessTemp!;
    const radius = sim.radius;
    gl.disable(gl.BLEND);

    this.scene!.bind();
    this.background
      .use()
      .set('uCameraWorld', view.cameraWorld)
      .set('uTanHalfFov', view.tanHalfFov)
      .set('uAspect', view.aspect)
      .set('uScene', scene.scene)
      .set('uDipperOn', scene.dipperOn)
      .set('uDipperPos', scene.dipperTo)
      .set('uDipperAngle', scene.dipperAngle)
      .set('uCoat', look.coat);
    drawFullscreen(gl);

    const splat = (p: Program, projScale: number) =>
      p
        .use()
        .set('uTexW', sim.texWidth)
        .set('uModelView', view.modelView)
        .set('uProj', view.proj)
        .set('uRadius', radius)
        .set('uProjScale', projScale)
        .texture('uPos', sim.positionTexture)
        .texture('uVel', sim.velocityTexture);

    depth.bind();
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    if (sim.count > 0) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      splat(this.depthProgram, view.projScale);
      bindEmptyVao(gl);
      gl.drawArrays(gl.POINTS, 0, sim.count);
      gl.disable(gl.DEPTH_TEST);
    }

    thickness.bind();
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    if (sim.count > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      splat(this.thicknessProgram, view.projScale * (thickness.height / view.height));
      gl.drawArrays(gl.POINTS, 0, sim.count);
      gl.disable(gl.BLEND);
    }

    const blur = this.blurProgram.use();
    const blurPass = (src: RenderTarget, dst: RenderTarget, dir: [number, number]) => {
      dst.bind();
      blur.texture('uTex', src.texture).set('uDir', dir);
      drawFullscreen(gl);
    };
    blur
      .set('uBilateral', 1)
      .set('uWorldRadius', radius * 3 * look.smoothing)
      .set('uProjScale', view.projScale)
      .set('uDepthFalloff', radius * 3)
      .set('uMaxRadius', Math.round(20 * Math.max(look.smoothing, 0.1)));
    const iterations = look.smoothing > 0 ? 3 : 0;
    for (let i = 0; i < iterations; i++) {
      blurPass(depth, depthTemp, [1, 0]);
      blurPass(depthTemp, depth, [0, 1]);
    }
    blur.set('uBilateral', 0).set('uMaxRadius', 10);
    for (let i = 0; i < 2; i++) {
      blurPass(thickness, thicknessTemp, [1, 0]);
      blurPass(thicknessTemp, thickness, [0, 1]);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.width, view.height);
    this.composite
      .use()
      .set('uCameraWorld', view.cameraWorld)
      .set('uTanHalfFov', view.tanHalfFov)
      .set('uAspect', view.aspect)
      .set('uAbsorption', look.absorption)
      .set('uScatter', look.scatter)
      .set('uRefraction', look.refraction)
      .set('uExposure', look.exposure)
      .set('uThicknessScale', sim.spacing ** 3 / ((4 / 3) * Math.PI * radius ** 3))
      .texture('uDepth', depth.texture)
      .texture('uThickness', thickness.texture)
      .texture('uScene', this.scene!.texture);
    drawFullscreen(gl);
  }

  private disposeTargets(): void {
    this.scene?.dispose();
    this.depth?.dispose();
    this.depthTemp?.dispose();
    this.thickness?.dispose();
    this.thicknessTemp?.dispose();
  }
}
