import { Matrix4, OrthographicCamera, Vector3 } from 'three';
import { bindEmptyVao, drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import { RenderTarget, r32f, rgba16f } from '../gl/target';
import type { ViewState } from '../render/camera';
import blurFs from '../render/shaders/blur.frag.glsl?raw';
import envSrc from '../honey/shaders/honeyEnv.glsl?raw';
import type { Ball, SandSimulator } from './SandSimulator';
import sceneSrc from './shaders/sandScene.glsl?raw';
import lightSrc from './shaders/sandLight.glsl?raw';
import shadowVs from './shaders/shadow.vert.glsl?raw';
import shadowFs from './shaders/shadow.frag.glsl?raw';
import splatVs from './shaders/splat.vert.glsl?raw';
import splatFs from './shaders/splat.frag.glsl?raw';
import backgroundFs from './shaders/background.frag.glsl?raw';
import compositeFs from './shaders/composite.frag.glsl?raw';

export interface SandLook {
  /** Surface smoothing, 0 shows the simulated particles as spheres. */
  smoothing: number;
  /** Size of the sand grains drawn on the surface, world units. */
  grainSize: number;
  exposure: number;
}

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** Matches KEY_DIR in honeyEnv.glsl. */
const KEY_DIR = new Vector3(-0.55, 0.75, 0.35).normalize();
const SHADOW_SIZE = 1024;
const SHADOW_EXTENT = 1.15;
const SHADOW_NEAR = 0.1;
const SHADOW_FAR = 6;

/** Grain depth plus the colour and centre of the nearest particle, drawn in one pass. */
class SplatTarget {
  readonly depth: WebGLTexture;
  readonly color: WebGLTexture;
  /** Centre and seed of the nearest particle. */
  readonly particle: WebGLTexture;
  /** Both textures and a depth buffer, for splatting. */
  readonly framebuffer: WebGLFramebuffer;
  /** The depth texture alone, for blurring back into. */
  readonly depthFramebuffer: WebGLFramebuffer;
  private readonly renderbuffer: WebGLRenderbuffer;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly width: number,
    readonly height: number,
  ) {
    const texture = (internal: GLenum, format: GLenum, type: GLenum) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, null);
      return t;
    };
    this.depth = texture(gl.R32F, gl.RED, gl.FLOAT);
    this.color = texture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.particle = texture(gl.RGBA32F, gl.RGBA, gl.FLOAT);
    this.renderbuffer = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.renderbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);

    this.framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.depth, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.color, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, this.particle, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.renderbuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

    this.depthFramebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.depthFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.depth, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Splat framebuffer incomplete (0x${status.toString(16)})`);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.depth);
    gl.deleteTexture(this.color);
    gl.deleteTexture(this.particle);
    gl.deleteRenderbuffer(this.renderbuffer);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteFramebuffer(this.depthFramebuffer);
  }
}

/**
 * The table, sandbox and ball are ray marched; the grains are splatted as spheres, lightly
 * smoothed into a surface and shaded with each grain's own colour. A shadow map rendered from the
 * key light lets piles shadow the sandbox and each other.
 */
export class SandRenderer {
  private readonly shadowProgram: Program;
  private readonly background: Program;
  private readonly splatProgram: Program;
  private readonly blurProgram: Program;
  private readonly composite: Program;
  private readonly shadow: RenderTarget;
  private readonly lightMatrix: Float32Array;

  private scene: RenderTarget | null = null;
  private splat: SplatTarget | null = null;
  private depthTemp: RenderTarget | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    const lit = HEADER + sceneSrc + envSrc + lightSrc;
    this.shadowProgram = new Program(gl, shadowVs, shadowFs, 'sandShadow');
    this.background = new Program(gl, FULLSCREEN_VS, lit + backgroundFs, 'sandBackground');
    this.splatProgram = new Program(gl, splatVs, splatFs, 'sandSplat');
    this.blurProgram = new Program(gl, FULLSCREEN_VS, blurFs, 'sandBlur');
    this.composite = new Program(gl, FULLSCREEN_VS, lit + compositeFs, 'sandComposite');
    this.shadow = new RenderTarget(gl, SHADOW_SIZE, SHADOW_SIZE, { ...r32f(gl), filter: gl.NEAREST }, true);

    const center = new Vector3(0, -0.35, 0);
    const light = new OrthographicCamera(-SHADOW_EXTENT, SHADOW_EXTENT, SHADOW_EXTENT, -SHADOW_EXTENT, SHADOW_NEAR, SHADOW_FAR);
    light.position.copy(center).addScaledVector(KEY_DIR, 3);
    light.lookAt(center);
    light.updateMatrixWorld();
    light.updateProjectionMatrix();
    this.lightMatrix = new Float32Array(new Matrix4().multiplyMatrices(light.projectionMatrix, light.matrixWorldInverse).elements);
  }

  private ensureTargets(width: number, height: number): void {
    if (this.scene && this.scene.width === width && this.scene.height === height) return;
    this.disposeTargets();
    const gl = this.gl;
    this.scene = new RenderTarget(gl, width, height, rgba16f(gl));
    this.splat = new SplatTarget(gl, width, height);
    this.depthTemp = new RenderTarget(gl, width, height, r32f(gl));
  }

  render(view: ViewState, sim: SandSimulator, ball: Ball, look: SandLook): void {
    const gl = this.gl;
    this.ensureTargets(view.width, view.height);
    const splat = this.splat!;
    const depthTemp = this.depthTemp!;
    const radius = sim.radius;
    gl.disable(gl.BLEND);
    bindEmptyVao(gl);

    // Shadow map of the grains from the key light.
    this.shadow.bind();
    gl.clearBufferfv(gl.COLOR, 0, [1, 1, 1, 1]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    if (sim.count > 0) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      this.shadowProgram
        .use()
        .set('uTexW', sim.texWidth)
        .set('uLightMatrix', this.lightMatrix)
        .set('uPointSize', (2 * radius * SHADOW_SIZE) / (2 * SHADOW_EXTENT))
        .texture('uPos', sim.positionTexture);
      gl.drawArrays(gl.POINTS, 0, sim.count);
      gl.disable(gl.DEPTH_TEST);
    }

    const lighting = (p: Program) =>
      p
        .use()
        .set('uCameraWorld', view.cameraWorld)
        .set('uTanHalfFov', view.tanHalfFov)
        .set('uAspect', view.aspect)
        .set('uBallOn', ball.on)
        .set('uBallPos', ball.position)
        .set('uBallRadius', ball.radius)
        .set('uLightMatrix', this.lightMatrix)
        .set('uShadowBias', (radius * 2.5) / (SHADOW_FAR - SHADOW_NEAR))
        .texture('uShadowMap', this.shadow.texture);

    this.scene!.bind();
    lighting(this.background);
    drawFullscreen(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, splat.framebuffer);
    gl.viewport(0, 0, view.width, view.height);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 2, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    if (sim.count > 0) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      this.splatProgram
        .use()
        .set('uTexW', sim.texWidth)
        .set('uModelView', view.modelView)
        .set('uProj', view.proj)
        .set('uRadius', radius)
        .set('uProjScale', view.projScale)
        .texture('uPos', sim.positionTexture);
      gl.drawArrays(gl.POINTS, 0, sim.count);
      gl.disable(gl.DEPTH_TEST);
    }

    if (look.smoothing > 0) {
      const blur = this.blurProgram
        .use()
        .set('uBilateral', 1)
        .set('uWorldRadius', radius * 1.5 * look.smoothing)
        .set('uProjScale', view.projScale)
        .set('uDepthFalloff', radius * 1.5)
        .set('uMaxRadius', Math.round(10 * look.smoothing));
      for (let i = 0; i < 3; i++) {
        depthTemp.bind();
        blur.texture('uTex', splat.depth).set('uDir', [1, 0]);
        drawFullscreen(gl);
        gl.bindFramebuffer(gl.FRAMEBUFFER, splat.depthFramebuffer);
        blur.texture('uTex', depthTemp.texture).set('uDir', [0, 1]);
        drawFullscreen(gl);
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.width, view.height);
    lighting(this.composite)
      .set('uExposure', look.exposure)
      .set('uGrainSize', look.grainSize)
      .texture('uDepth', splat.depth)
      .texture('uColor', splat.color)
      .texture('uParticle', splat.particle)
      .texture('uScene', this.scene!.texture);
    drawFullscreen(gl);
  }

  private disposeTargets(): void {
    this.scene?.dispose();
    this.splat?.dispose();
    this.depthTemp?.dispose();
  }
}
