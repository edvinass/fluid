#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uPos;
uniform int uTexW;
uniform mat4 uLightMatrix;
uniform float uPointSize;

// A grain as seen from the key light, for the shadow map.
void main() {
  ivec2 c = ivec2(gl_VertexID % uTexW, gl_VertexID / uTexW);
  gl_Position = uLightMatrix * vec4(texelFetch(uPos, c, 0).xyz, 1.0);
  gl_PointSize = uPointSize;
}
