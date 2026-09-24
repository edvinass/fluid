#version 300 es
precision highp float;

uniform mat4 uProj;
uniform float uRadius;
uniform float uMaxSpeed;
uniform vec3 uLightDirView;

in vec3 vViewCenter;
in float vSpeed;
out vec4 outColor;

vec3 speedColor(float t) {
  vec3 slow = vec3(0.05, 0.25, 0.75);
  vec3 mid = vec3(0.15, 0.75, 0.95);
  vec3 fast = vec3(0.95, 0.98, 1.0);
  return t < 0.5 ? mix(slow, mid, t * 2.0) : mix(mid, fast, t * 2.0 - 1.0);
}

// Shaded sphere impostor coloured by particle speed.
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  vec3 n = vec3(c, sqrt(1.0 - r2));
  vec3 viewPos = vViewCenter + n * uRadius;
  vec4 clip = uProj * vec4(viewPos, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;

  vec3 base = speedColor(clamp(vSpeed / uMaxSpeed, 0.0, 1.0));
  float diffuse = max(dot(n, uLightDirView), 0.0);
  float specular = pow(max(dot(reflect(-uLightDirView, n), vec3(0.0, 0.0, 1.0)), 0.0), 32.0);
  outColor = vec4(base * (0.3 + 0.7 * diffuse) + vec3(0.35) * specular, 1.0);
}
