#version 300 es
precision highp float;

uniform float uRadius;

in vec3 vViewCenter;
in float vSpeed;
out vec4 outThickness;

// Additively accumulates the chord length through each particle's sphere.
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  outThickness = vec4(2.0 * uRadius * sqrt(1.0 - r2), 0.0, 0.0, 1.0);
}
