// Shared by the fire render passes: camera rays, the night backdrop, flame colours and the light
// cast by the fire. Requires grid.glsl and fireScene.glsl.
uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec3 uBoxHalf;
uniform float uCellSize;
uniform sampler2D uState;
uniform sampler2D uLight;
uniform float uLightScale;
uniform vec3 uFlameTint;
uniform float uTintAmount;

vec3 cameraRay(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  return normalize(mat3(uCameraWorld) * vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0));
}

bool boxHit(vec3 ro, vec3 rd, out float t0, out float t1) {
  vec3 inv = 1.0 / rd;
  vec3 a = (-uBoxHalf - ro) * inv;
  vec3 b = (uBoxHalf - ro) * inv;
  vec3 lo = min(a, b);
  vec3 hi = max(a, b);
  t0 = max(max(lo.x, lo.y), lo.z);
  t1 = min(min(hi.x, hi.y), hi.z);
  return t1 > max(t0, 0.0);
}

vec3 toCell(vec3 world) {
  return (world + uBoxHalf) / uCellSize;
}

// Emitted light per unit length at a given temperature: deep red through orange to a white-hot
// core, optionally tinted like a flame-test chemical.
vec3 flameColor(float t) {
  t = min(t, 2.5);
  vec3 c = vec3(smoothstep(0.12, 0.7, t) * 2.6, smoothstep(0.4, 1.5, t) * 1.5, smoothstep(1.1, 2.8, t) * 1.1);
  c *= smoothstep(0.2, 0.6, t);
  float lum = dot(c, vec3(0.35, 0.5, 0.15));
  return mix(c, uFlameTint * lum, uTintAmount);
}

// The fire as a single point light at its centre of glow.
vec3 fireLight(vec3 p, out vec3 dir, out float dist) {
  vec4 acc = texelFetch(uLight, ivec2(0), 0);
  vec3 center = acc.w > 1e-4 ? acc.xyz / acc.w : vec3(0.0, uGround + 0.3, 0.0);
  vec3 d = center - p;
  float dist2 = dot(d, d);
  dist = sqrt(dist2);
  dir = d / max(dist, 1e-4);
  vec3 color = mix(normalize(flameColor(1.2) + 1e-4), vec3(0.58), 0.3) * 1.4;
  return color * acc.w * uLightScale / (dist2 + 0.04);
}

vec3 nightSky(vec3 rd) {
  float up = clamp(rd.y, -1.0, 1.0);
  vec3 col = mix(vec3(0.004, 0.005, 0.009), vec3(0.0015, 0.002, 0.006), smoothstep(0.0, 0.6, up));
  vec3 q = rd * 260.0;
  vec3 cell = floor(q);
  float star = hash13(cell);
  if (up > 0.02 && star > 0.996) {
    float d = length(fract(q) - 0.5);
    col += vec3(0.8, 0.85, 1.0) * smoothstep(0.35, 0.0, d) * (star - 0.996) * 90.0 * smoothstep(0.02, 0.2, up);
  }
  return col;
}

vec3 ground(vec3 hit, float t) {
  vec2 g = hit.xz;
  float n = noise3(vec3(g * 6.0, 0.0)) * 0.6 + noise3(vec3(g * 23.0, 1.0)) * 0.4;
  vec3 albedo = mix(vec3(0.05, 0.04, 0.032), vec3(0.11, 0.09, 0.07), n);
  float ash = smoothstep(0.55, 0.2, length(g)) * float(uScene == 0);
  albedo = mix(albedo, vec3(0.03, 0.028, 0.027), ash * 0.8);

  vec3 l;
  float dist;
  vec3 light = fireLight(hit, l, dist);
  float shadow = sceneShadow(hit + vec3(0.0, 0.002, 0.0), l, dist);
  vec3 col = albedo * (light * max(l.y, 0.0) * shadow + vec3(0.006, 0.008, 0.014));
  return mix(nightSky(vec3(0.0, 0.0, 1.0)), col, exp(-t * 0.18));
}

vec3 backdrop(vec3 ro, vec3 rd) {
  if (rd.y < -1e-4) {
    float t = (uGround - ro.y) / rd.y;
    if (t > 0.0) return ground(ro + rd * t, t);
  }
  return nightSky(rd);
}
