uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uTime;

const float FLOOR_Y = -1.55;
const float BASE_TOP_R = 0.62;
const float BASE_BOTTOM_R = 0.82;
const float STEM_R = 0.028;

vec3 cameraRay(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  return normalize(mat3(uCameraWorld) * vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0));
}

// Near and far distances along the ray to a sphere at the origin, or (-1, -1) on a miss.
vec2 sphereHit(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float h = b * b - dot(ro, ro) + r * r;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float softbox(vec3 d, vec3 center, vec3 up, vec2 halfSize) {
  vec3 f = normalize(center);
  vec3 r = normalize(cross(up, f));
  vec3 u = cross(f, r);
  float z = dot(d, f);
  if (z <= 0.0) return 0.0;
  vec2 q = vec2(dot(d, r), dot(d, u)) / z;
  vec2 e = abs(q) - halfSize;
  float edge = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - 0.05;
  return smoothstep(0.08, -0.08, edge);
}

// A dark room at night: a faint moonlit window to one side and a dim glow from a doorway.
vec3 roomEnv(vec3 d) {
  vec3 col = mix(vec3(0.006, 0.006, 0.01), vec3(0.012, 0.012, 0.02), smoothstep(-0.3, 0.6, d.y));
  col += vec3(0.16, 0.2, 0.3) * softbox(d, vec3(-0.8, 0.35, -0.5), vec3(0.0, 1.0, 0.0), vec2(0.35, 0.45));
  col += vec3(0.1, 0.07, 0.05) * softbox(d, vec3(0.9, 0.1, 0.4), vec3(0.0, 1.0, 0.0), vec2(0.12, 0.6));
  return col;
}
