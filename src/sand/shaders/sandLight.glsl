// Shadows from the key light: the grains (from a shadow map rendered from the light) and the
// scenery (ray marched). Needs sandScene.glsl and honeyEnv.glsl.
uniform sampler2D uShadowMap;
uniform mat4 uLightMatrix;
uniform float uShadowBias;

float grainShadow(vec3 p) {
  vec4 c = uLightMatrix * vec4(p, 1.0);
  vec3 s = c.xyz / c.w * 0.5 + 0.5;
  if (any(lessThan(s.xy, vec2(0.0))) || any(greaterThan(s.xy, vec2(1.0)))) return 1.0;
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float lit = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      float d = texture(uShadowMap, s.xy + vec2(i, j) * texel * 1.5).r;
      lit += s.z - uShadowBias > d ? 0.0 : 1.0;
    }
  }
  return lit / 9.0;
}

float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0;
  float t = 0.01;
  for (int i = 0; i < 32; i++) {
    float h = sceneSDF(ro + rd * t);
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.01, 0.2);
    if (res < 0.01 || t > 2.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.103, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
