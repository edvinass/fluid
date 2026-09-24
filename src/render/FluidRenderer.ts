import { bindEmptyVao, drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import { RenderTarget, r16f, r32f, rgba8 } from '../gl/target';
import type { SPHSimulator, Vec3 } from '../sim/SPHSimulator';
import type { ViewState } from './camera';
import type { Container } from './Container';
import splatVs from './shaders/splat.vert.glsl?raw';
import splatDepthFs from './shaders/splatDepth.frag.glsl?raw';
import splatThicknessFs from './shaders/splatThickness.frag.glsl?raw';
import blurFs from './shaders/blur.frag.glsl?raw';
import compositeFs from './shaders/composite.frag.glsl?raw';
import envSrc from './shaders/env.glsl?raw';

export interface FluidLook {
  waterColor: Vec3;
  absorption: Vec3;
  refraction: number;
  smoothing: number;
}

/**
 * Screen-space fluid rendering: particle depth splats are smoothed with a bilateral blur,
 * turned into normals and shaded as a continuous liquid surface.
 */
export class FluidRenderer {
  private readonly depthProgram: Program;
  private readonly thicknessProgram: Program;
  private readonly blurProgram: Program;
  private readonly compositeProgram: Program;

  private scene: RenderTarget | null = null;
  private depth: RenderTarget | null = null;
  private depthTemp: RenderTarget | null = null;
  private thickness: RenderTarget | null = null;
  private thicknessTemp: RenderTarget | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.depthProgram = new Program(gl, splatVs, splatDepthFs, 'splatDepth');
    this.thicknessProgram = new Program(gl, splatVs, splatThicknessFs, 'splatThickness');
    this.blurProgram = new Program(gl, FULLSCREEN_VS, blurFs, 'blur');
    const compositeSrc = `#version 300 es
precision highp float;
precision highp sampler2D;
${envSrc}
${compositeFs}`;
    this.compositeProgram = new Program(gl, FULLSCREEN_VS, compositeSrc, 'composite');
  }

  private ensureTargets(width: number, height: number): void {
    if (this.scene && this.scene.width === width && this.scene.height === height) return;
    this.disposeTargets();
    const gl = this.gl;
    const hw = Math.max(1, width >> 1);
    const hh = Math.max(1, height >> 1);
    this.scene = new RenderTarget(gl, width, height, rgba8(gl));
    this.depth = new RenderTarget(gl, width, height, r32f(gl), true);
    this.depthTemp = new RenderTarget(gl, width, height, r32f(gl));
    this.thickness = new RenderTarget(gl, hw, hh, r16f(gl));
    this.thicknessTemp = new RenderTarget(gl, hw, hh, r16f(gl));
  }

  /** Target the caller should draw the background into before calling `render`. */
  sceneTarget(width: number, height: number): RenderTarget {
    this.ensureTargets(width, height);
    return this.scene!;
  }

  render(view: ViewState, sim: SPHSimulator, container: Container, look: FluidLook): void {
    const gl = this.gl;
    this.ensureTargets(view.width, view.height);
    const depth = this.depth!;
    const depthTemp = this.depthTemp!;
    const thickness = this.thickness!;
    const thicknessTemp = this.thicknessTemp!;
    const radius = sim.radius;

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

    // Depth of the nearest sphere surface per pixel.
    depth.bind();
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    splat(this.depthProgram, view.projScale);
    bindEmptyVao(gl);
    gl.drawArrays(gl.POINTS, 0, sim.count);
    gl.disable(gl.DEPTH_TEST);

    // Accumulated thickness at half resolution.
    thickness.bind();
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    splat(this.thicknessProgram, view.projScale * (thickness.height / view.height));
    gl.drawArrays(gl.POINTS, 0, sim.count);
    gl.disable(gl.BLEND);

    // Smooth the depth (bilateral) and thickness (gaussian).
    const blur = this.blurProgram.use();
    const blurPass = (src: RenderTarget, dst: RenderTarget, dir: [number, number]) => {
      dst.bind();
      blur.texture('uTex', src.texture).set('uDir', dir);
      drawFullscreen(gl);
    };
    blur
      .set('uBilateral', 1)
      .set('uWorldRadius', radius * 2.5 * look.smoothing)
      .set('uProjScale', view.projScale)
      .set('uDepthFalloff', radius * 3)
      .set('uMaxRadius', Math.round(18 * Math.max(look.smoothing, 0.1)));
    const iterations = look.smoothing > 0 ? 2 : 0;
    for (let i = 0; i < iterations; i++) {
      blurPass(depth, depthTemp, [1, 0]);
      blurPass(depthTemp, depth, [0, 1]);
    }
    blur.set('uBilateral', 0).set('uMaxRadius', 4);
    blurPass(thickness, thicknessTemp, [1, 0]);
    blurPass(thicknessTemp, thickness, [0, 1]);

    // Shade to the screen, writing fluid depth so the container edges can be depth-tested.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.width, view.height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.depthMask(true);
    const comp = this.compositeProgram.use();
    container
      .setEnvUniforms(comp, view)
      .set('uProj', view.proj)
      .set('uCameraWorld', view.cameraWorld)
      .set('uTanHalfFov', view.tanHalfFov)
      .set('uAspect', view.aspect)
      .set('uWaterColor', look.waterColor)
      .set('uAbsorption', look.absorption)
      .set('uRefraction', look.refraction)
      .texture('uDepth', depth.texture)
      .texture('uThickness', thickness.texture)
      .texture('uScene', this.scene!.texture);
    drawFullscreen(gl);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.DEPTH_TEST);
  }

  private disposeTargets(): void {
    this.scene?.dispose();
    this.depth?.dispose();
    this.depthTemp?.dispose();
    this.thickness?.dispose();
    this.thicknessTemp?.dispose();
  }
}
