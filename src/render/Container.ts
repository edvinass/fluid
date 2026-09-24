import { bindEmptyVao, drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import type { Vec3 } from '../sim/SPHSimulator';
import type { ViewState } from './camera';
import envSrc from './shaders/env.glsl?raw';

const HEADER = `#version 300 es
precision highp float;
`;

const BACKGROUND_FS = `${HEADER}
${envSrc}
uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 dirView = normalize(vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0));
  vec3 rd = normalize(mat3(uCameraWorld) * dirView);
  vec3 ro = uCameraWorld[3].xyz;
  outColor = vec4(environment(ro, rd), 1.0);
}
`;

const EDGES_VS = `#version 300 es
uniform mat4 uModelView;
uniform mat4 uProj;
uniform vec3 uBoxHalf;
const int EDGES[24] = int[24](0,1, 1,3, 3,2, 2,0, 4,5, 5,7, 7,6, 6,4, 0,4, 1,5, 2,6, 3,7);
void main() {
  int corner = EDGES[gl_VertexID];
  vec3 c = vec3(corner & 1, (corner >> 1) & 1, (corner >> 2) & 1) * 2.0 - 1.0;
  gl_Position = uProj * uModelView * vec4(c * uBoxHalf, 1.0);
}
`;

const EDGES_FS = `${HEADER}
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }
`;

export const SUN_DIR: Vec3 = (() => {
  const v: Vec3 = [0.45, 0.75, 0.35];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

/** Draws the environment backdrop and the container's outline. */
export class Container {
  readonly floorY: number;
  private readonly background: Program;
  private readonly edges: Program;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly boxHalf: Vec3,
  ) {
    this.floorY = -Math.hypot(...boxHalf) - 0.05;
    this.background = new Program(gl, FULLSCREEN_VS, BACKGROUND_FS, 'background');
    this.edges = new Program(gl, EDGES_VS, EDGES_FS, 'edges');
  }

  /** Uniforms needed by any shader that includes env.glsl. */
  setEnvUniforms(p: Program, view: ViewState): Program {
    return p
      .set('uSunDir', SUN_DIR)
      .set('uFloorY', this.floorY)
      .set('uBoxHalfEnv', this.boxHalf)
      .set('uBoxInvRot', view.boxInvRot);
  }

  drawBackground(view: ViewState): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(false);
    const p = this.background.use();
    this.setEnvUniforms(p, view)
      .set('uCameraWorld', view.cameraWorld)
      .set('uTanHalfFov', view.tanHalfFov)
      .set('uAspect', view.aspect);
    drawFullscreen(gl);
    gl.depthMask(true);
  }

  /** Draws the box outline. With `depthTest`, only edges in front of the current depth buffer are drawn. */
  drawEdges(view: ViewState, depthTest: boolean): void {
    const gl = this.gl;
    if (depthTest) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
    } else {
      gl.disable(gl.DEPTH_TEST);
    }
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.edges
      .use()
      .set('uModelView', view.modelView)
      .set('uProj', view.proj)
      .set('uBoxHalf', this.boxHalf)
      .set('uColor', [0.8, 0.9, 1.0, 0.45]);
    bindEmptyVao(gl);
    gl.drawArrays(gl.LINES, 0, 24);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
}
