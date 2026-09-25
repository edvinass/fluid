// Solid scenery (campfire logs and stones, or a gas burner) as a signed distance function in
// world units, plus value noise shared by the simulation and the renderer.
uniform int uScene; // 0 campfire, 1 gas burner, otherwise nothing
uniform float uGround; // world y of the ground

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
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

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// Five logs leaning into a teepee over two crossed base logs. p is relative to the fire centre on the ground.
float campfireLogs(vec3 p) {
  float d = sdCapsule(p, vec3(-0.34, 0.042, -0.12), vec3(0.3, 0.042, 0.16), 0.042);
  d = min(d, sdCapsule(p, vec3(-0.18, 0.04, 0.3), vec3(0.14, 0.04, -0.32), 0.04));
  for (int i = 0; i < 5; i++) {
    float a = float(i) * 1.2566 + 0.3;
    vec3 base = vec3(cos(a) * 0.3, 0.035, sin(a) * 0.3);
    vec3 top = vec3(cos(a + 0.4) * 0.035, 0.36, sin(a + 0.4) * 0.035);
    d = min(d, sdCapsule(p, base, top, 0.032 + 0.006 * float(i % 2)));
  }
  return d;
}

float campfireStones(vec3 p) {
  const float N = 11.0;
  float sector = 6.2831853 / N;
  float i = floor(atan(p.z, p.x) / sector + 0.5);
  float jitter = hash13(vec3(i, 1.0, 7.0));
  float a = i * sector;
  vec3 q = p - vec3(cos(a), 0.0, sin(a)) * (0.47 + 0.03 * jitter) - vec3(0.0, 0.02, 0.0);
  vec3 r = vec3(0.075, 0.055, 0.065) * (0.85 + 0.3 * jitter);
  float k0 = length(q / r);
  return k0 * (k0 - 1.0) / length(q / (r * r));
}

float burner(vec3 p) {
  float d = length(vec2(length(p.xz) - 0.25, p.y - 0.1)) - 0.024;
  d = min(d, sdCapsule(p, vec3(0.0, 0.0, 0.0), vec3(0.0, 0.1, 0.0), 0.04));
  for (int i = 0; i < 3; i++) {
    float a = float(i) * 2.0944;
    d = min(d, sdCapsule(p, vec3(0.0, 0.1, 0.0), vec3(cos(a), 0.0, sin(a)) * 0.25 + vec3(0.0, 0.1, 0.0), 0.012));
  }
  return d;
}

float sceneSdf(vec3 world) {
  vec3 p = world - vec3(0.0, uGround, 0.0);
  if (uScene == 0) return min(campfireLogs(p), campfireStones(p));
  if (uScene == 1) return burner(p);
  return 1e3;
}

// 0 wood, 1 stone, 2 metal
int sceneMaterial(vec3 world) {
  vec3 p = world - vec3(0.0, uGround, 0.0);
  if (uScene == 0) return campfireLogs(p) < campfireStones(p) ? 0 : 1;
  return 2;
}

vec3 sceneNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.001;
  return normalize(k.xyy * sceneSdf(p + k.xyy * h) + k.yyx * sceneSdf(p + k.yyx * h)
    + k.yxy * sceneSdf(p + k.yxy * h) + k.xxx * sceneSdf(p + k.xxx * h));
}

bool sceneBounds(vec3 ro, vec3 rd, out float tIn, out float tOut) {
  if (uScene > 1) return false;
  vec3 oc = ro - vec3(0.0, uGround + 0.15, 0.0);
  float b = dot(oc, rd);
  float h = b * b - dot(oc, oc) + 0.36;
  if (h < 0.0) return false;
  h = sqrt(h);
  tIn = -b - h;
  tOut = -b + h;
  return tOut > 0.0;
}

bool traceScene(vec3 ro, vec3 rd, float tMax, out float tHit) {
  float tIn, tOut;
  if (!sceneBounds(ro, rd, tIn, tOut)) return false;
  float t = max(tIn, 0.0);
  tOut = min(tOut, tMax);
  for (int i = 0; i < 96; i++) {
    if (t > tOut) return false;
    float d = sceneSdf(ro + rd * t);
    if (d < 0.0005) {
      tHit = t;
      return true;
    }
    t += max(d * 0.9, 0.0008);
  }
  return false;
}

// Soft shadow towards a light `maxT` away.
float sceneShadow(vec3 ro, vec3 rd, float maxT) {
  float tIn, tOut;
  if (!sceneBounds(ro, rd, tIn, tOut)) return 1.0;
  float t = max(tIn, 0.01);
  tOut = min(tOut, maxT);
  float shadow = 1.0;
  for (int i = 0; i < 40; i++) {
    if (t > tOut) break;
    float d = sceneSdf(ro + rd * t);
    shadow = min(shadow, 8.0 * d / t);
    if (shadow < 0.02) return 0.0;
    t += clamp(d, 0.005, 0.06);
  }
  return clamp(shadow, 0.0, 1.0);
}
