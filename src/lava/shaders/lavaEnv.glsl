// A dark room lit mostly by the lamp itself. Needs lamp.glsl.
uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec3 uGlowColor; // light given off by the lamp, linear
uniform vec3 uWaxColor;

const vec3 LAMP_CENTER = vec3(0.0, -0.2, 0.0);

vec3 environment(vec3 d) {
  vec3 col = mix(vec3(0.012, 0.011, 0.016), vec3(0.03, 0.028, 0.04), smoothstep(-0.3, 0.8, d.y));
  // A faint window with city light, off to one side.
  vec2 q = vec2(atan(d.x, -d.z), d.y);
  vec2 e = abs(q - vec2(-1.1, 0.25)) - vec2(0.35, 0.3);
  col += vec3(0.05, 0.07, 0.14) * smoothstep(0.05, -0.05, max(e.x, e.y));
  return col;
}

/** Light from the lamp reaching a point with normal n (glow from the whole lit vessel). */
vec3 lampLight(vec3 p, vec3 n) {
  vec3 toLamp = LAMP_CENTER - p;
  float d = length(toLamp);
  vec3 l = toLamp / d;
  float wrap = max(dot(n, l) * 0.8 + 0.2, 0.0);
  return (uGlowColor * 0.9 + uWaxColor * 0.25) * wrap / (1.0 + 3.0 * d * d);
}

vec3 cameraRay(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  return normalize(mat3(uCameraWorld) * vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0));
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
