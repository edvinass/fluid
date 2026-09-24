import { bindEmptyVao } from '../gl/context';
import { Program } from '../gl/program';
import type { SPHSimulator } from '../sim/SPHSimulator';
import type { ViewState } from './camera';
import { SUN_DIR } from './Container';
import splatVs from './shaders/splat.vert.glsl?raw';
import particleFs from './shaders/particle.frag.glsl?raw';

/** Debug view: every particle as a shaded sphere coloured by speed. */
export class ParticleRenderer {
  private readonly program: Program;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = new Program(gl, splatVs, particleFs, 'particles');
  }

  /** Draws into the currently bound framebuffer, which must have a depth buffer. */
  render(view: ViewState, sim: SPHSimulator): void {
    const gl = this.gl;
    const v = view.view;
    const lightView = [
      v[0] * SUN_DIR[0] + v[4] * SUN_DIR[1] + v[8] * SUN_DIR[2],
      v[1] * SUN_DIR[0] + v[5] * SUN_DIR[1] + v[9] * SUN_DIR[2],
      v[2] * SUN_DIR[0] + v[6] * SUN_DIR[1] + v[10] * SUN_DIR[2],
    ];
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this.program
      .use()
      .set('uTexW', sim.texWidth)
      .set('uModelView', view.modelView)
      .set('uProj', view.proj)
      .set('uRadius', sim.radius * 0.8)
      .set('uProjScale', view.projScale)
      .set('uMaxSpeed', 4)
      .set('uLightDirView', lightView)
      .texture('uPos', sim.positionTexture)
      .texture('uVel', sim.velocityTexture);
    bindEmptyVao(gl);
    gl.drawArrays(gl.POINTS, 0, sim.count);
  }
}
