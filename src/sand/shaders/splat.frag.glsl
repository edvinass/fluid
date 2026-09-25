#version 300 es
precision highp float;

uniform mat4 uProj;
uniform float uRadius; // particle radius; bigger splats are pushed back to match it

in vec3 vViewCenter;
flat in float vRadius;
flat in vec4 vColor;
flat in vec4 vParticle;
layout(location = 0) out vec4 outDepth;
layout(location = 1) out vec4 outColor;
layout(location = 2) out vec4 outParticle;

// Linear view depth of the front of each particle's sphere, and the colour and centre of the
// nearest particle (the composite anchors the sand's grain texture to it).
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  vec3 viewPos = vViewCenter + vec3(c * vRadius, sqrt(1.0 - r2) * vRadius - (vRadius - uRadius));
  vec4 clip = uProj * vec4(viewPos, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
  outDepth = vec4(-viewPos.z, 0.0, 0.0, 1.0);
  outColor = vColor;
  outParticle = vParticle;
}
