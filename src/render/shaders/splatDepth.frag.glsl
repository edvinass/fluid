#version 300 es
precision highp float;

uniform mat4 uProj;
uniform float uRadius;

in vec3 vViewCenter;
in float vSpeed;
out vec4 outDepth;

// Writes the linear view depth of the front of each particle's sphere.
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  vec3 viewPos = vViewCenter + vec3(c, sqrt(1.0 - r2)) * uRadius;
  vec4 clip = uProj * vec4(viewPos, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
  outDepth = vec4(-viewPos.z, 0.0, 0.0, 1.0);
}
