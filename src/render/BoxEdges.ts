import { bindEmptyVao } from '../gl/context';
import { Program } from '../gl/program';
import type { ViewState } from './camera';

const EDGES_VS = `#version 300 es
uniform mat4 uModelView;
uniform mat4 uProj;
uniform vec3 uBoxHalf;
uniform vec3 uCamPos;
uniform int uFront;
const int EDGES[24] = int[24](0,1, 1,3, 3,2, 2,0, 4,5, 5,7, 7,6, 6,4, 0,4, 1,5, 2,6, 3,7);
vec3 cornerPos(int c) {
  return vec3(c & 1, (c >> 1) & 1, (c >> 2) & 1) * 2.0 - 1.0;
}
// An edge is in front if either face touching it faces the camera. Edges not in the requested
// set are moved outside the clip volume.
void main() {
  int e = gl_VertexID / 2;
  int a = EDGES[e * 2];
  int axis = a ^ EDGES[e * 2 + 1];
  vec3 s = cornerPos(a);
  bool front = false;
  for (int k = 0; k < 3; k++) {
    if (((axis >> k) & 1) == 0 && uCamPos[k] * s[k] > uBoxHalf[k]) front = true;
  }
  vec3 c = cornerPos(EDGES[gl_VertexID]);
  gl_Position = (front == (uFront == 1)) ? uProj * uModelView * vec4(c * uBoxHalf, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const EDGES_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }
`;

/** Outline of an axis-aligned glass box centred on the origin, drawn as back or front edges. */
export class BoxEdges {
  private readonly program: Program;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly boxHalf: [number, number, number],
  ) {
    this.program = new Program(gl, EDGES_VS, EDGES_FS, 'boxEdges');
  }

  draw(view: ViewState, color: [number, number, number, number], front: boolean): void {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.program
      .use()
      .set('uModelView', view.modelView)
      .set('uProj', view.proj)
      .set('uBoxHalf', this.boxHalf)
      .set('uCamPos', view.cameraPosition)
      .set('uFront', front ? 1 : 0)
      .set('uColor', front ? color : [color[0], color[1], color[2], color[3] * 0.6]);
    bindEmptyVao(gl);
    gl.drawArrays(gl.LINES, 0, 24);
    gl.disable(gl.BLEND);
  }
}
