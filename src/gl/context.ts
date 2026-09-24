export class UnsupportedError extends Error {}

export function createContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: true,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    throw new UnsupportedError('WebGL2 is not available in this browser.');
  }
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new UnsupportedError(
      'Your GPU or browser cannot render to floating-point textures (EXT_color_buffer_float is missing).',
    );
  }
  return gl;
}

let emptyVao: WebGLVertexArrayObject | null = null;

/** Binds an attribute-less VAO. All geometry in this app is generated from gl_VertexID. */
export function bindEmptyVao(gl: WebGL2RenderingContext): void {
  if (!emptyVao) emptyVao = gl.createVertexArray();
  gl.bindVertexArray(emptyVao);
}

export function drawFullscreen(gl: WebGL2RenderingContext): void {
  bindEmptyVao(gl);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;
