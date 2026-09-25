#version 300 es
precision highp float;

out vec4 outDepth;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  if (dot(c, c) > 1.0) discard;
  outDepth = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
}
