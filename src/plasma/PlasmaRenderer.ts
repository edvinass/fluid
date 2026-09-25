import { bindEmptyVao, drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import { RenderTarget, rgba16f, rgba32f } from '../gl/target';
import bloomFs from '../fire/shaders/bloom.frag.glsl?raw';
import type { ViewState } from '../render/camera';
import { BASE_TOP, ELECTRODE_RADIUS, GLASS_RADIUS, MAX_FILAMENTS, POINTS, STRIPS, type PlasmaSimulator, type Vec3 } from './PlasmaSimulator';
import commonSrc from './shaders/plasmaCommon.glsl?raw';
import sceneFs from './shaders/scene.frag.glsl?raw';
import filamentVs from './shaders/filament.vert.glsl?raw';
import filamentFs from './shaders/filament.frag.glsl?raw';
import compositeFs from './shaders/composite.frag.glsl?raw';

export interface PlasmaLook {
  bloom: number;
  exposure: number;
  /** How brightly the globe lights the table and base. */
  roomLight: number;
}

const BLOOM_LEVELS = 4;

const HEADER = `#version 300 es
precision highp float;
#define MAX_FILAMENTS ${MAX_FILAMENTS}
#define POINTS ${POINTS}
#define ELECTRODE_RADIUS ${ELECTRODE_RADIUS.toFixed(4)}
#define GLASS_RADIUS ${GLASS_RADIUS.toFixed(4)}
#define BASE_TOP ${BASE_TOP.toFixed(4)}
`;

/** The room, base and globe, the glowing filaments inside it, and bloom. */
export class PlasmaRenderer {
  private readonly scenePass: Program;
  private readonly filaments: Program;
  private readonly composite: Program;
  private readonly bloom: Program;
  private readonly paths: RenderTarget;
  private scene: RenderTarget | null = null;
  /** Per level: [downsampled, blurred horizontally]; the vertical blur writes back into the first. */
  private bloomTargets: [RenderTarget, RenderTarget][] = [];

  constructor(private readonly gl: WebGL2RenderingContext) {
    const fs = (src: string) => HEADER + commonSrc + src;
    this.scenePass = new Program(gl, FULLSCREEN_VS, fs(sceneFs), 'plasmaScene');
    this.filaments = new Program(gl, HEADER + filamentVs, fs(filamentFs), 'plasmaFilaments');
    this.composite = new Program(gl, FULLSCREEN_VS, fs(compositeFs), 'plasmaComposite');
    this.bloom = new Program(gl, FULLSCREEN_VS, bloomFs, 'bloom');
    this.paths = new RenderTarget(gl, POINTS * 2, STRIPS, rgba32f(gl));
  }

  private ensureTargets(width: number, height: number): void {
    const gl = this.gl;
    if (!this.scene || this.scene.width !== width || this.scene.height !== height) {
      this.scene?.dispose();
      this.scene = new RenderTarget(gl, width, height, rgba16f(gl));
    }
    // Bloom levels at 1/2 to 1/16 of the screen: the finest keeps a tight glow around each filament.
    const bw = Math.max(1, Math.round(width / 2));
    const bh = Math.max(1, Math.round(height / 2));
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

  render(view: ViewState, sim: PlasmaSimulator, gas: Vec3, look: PlasmaLook, time: number): void {
    const gl = this.gl;
    this.ensureTargets(view.width, view.height);
    const scene = this.scene!;
    this.paths.upload(sim.paths);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);

    let total = 0;
    for (let i = 0; i < MAX_FILAMENTS; i++) total += sim.ends[i * 4 + 3];
    const light = look.roomLight * (0.25 + 0.08 * total);
    const glow = gas.map((c) => c * light);
    const camera = (p: Program) =>
      p
        .use()
        .set('uCameraWorld', view.cameraWorld)
        .set('uTanHalfFov', view.tanHalfFov)
        .set('uAspect', view.aspect)
        .set('uTime', time);

    scene.bind();
    camera(this.scenePass)
      .set('uEnds', sim.ends)
      .set('uRoots', sim.roots)
      .set('uSpotColors', sim.colors)
      .set('uGas', gas.map((c) => c * (0.3 + 0.05 * total)))
      .set('uGlow', glow);
    drawFullscreen(gl);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
    camera(this.filaments)
      .set('uView', view.view)
      .set('uProj', view.proj)
      .set('uCameraPos', view.cameraPosition)
      .set('uProjScale', view.projScale)
      .texture('uPaths', this.paths.texture);
    bindEmptyVao(gl);
    gl.drawArrays(gl.TRIANGLES, 0, STRIPS * (POINTS - 1) * 6);
    gl.disable(gl.BLEND);

    this.renderBloom(scene);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.width, view.height);
    const [b0, b1, b2, b3] = this.bloomTargets;
    camera(this.composite)
      .set('uBloom', look.bloom)
      .set('uExposure', look.exposure)
      .texture('uScene', scene.texture)
      .texture('uBloom0', b0[0].texture)
      .texture('uBloom1', b1[0].texture)
      .texture('uBloom2', b2[0].texture)
      .texture('uBloom3', b3[0].texture);
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
