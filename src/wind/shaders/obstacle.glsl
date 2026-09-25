// The object in the tunnel as a signed distance function (world units, negative inside). Shapes
// are modelled with the flow along +x, up along +y and the span along z.
uniform int uShape; // 0 sphere, 1 cylinder, 2 cube, 3 wing, 4 car
uniform vec3 uObsPos;
uniform mat3 uObsRot; // world -> object rotation
uniform float uObsScale;
uniform float uObsBound; // bounding sphere radius (world)
uniform vec3 uTunnelHalf;

float sdBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdCylinderZ(vec3 p, float r, float halfLength) {
  vec2 d = abs(vec2(length(p.xy), p.z)) - vec2(r, halfLength);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// NACA 2415 section in chord units, leading edge at x = 0. Not an exact distance, but the sign
// and gradient are right, which is all the voxeliser and the (conservative) tracer need.
float airfoil(vec2 p) {
  const float t = 0.15;
  const float m = 0.02;
  const float pc = 0.4;
  float x = clamp(p.x, 0.0, 1.0);
  float yt = 5.0 * t * (0.2969 * sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
  float yc = x < pc ? m / (pc * pc) * (2.0 * pc * x - x * x) : m / ((1.0 - pc) * (1.0 - pc)) * (1.0 - 2.0 * pc + 2.0 * pc * x - x * x);
  float dy = abs(p.y - yc) - yt;
  float dx = max(-p.x, p.x - 1.0);
  if (dx > 0.0) return length(vec2(dx, max(dy, 0.0)));
  return dy * 0.7;
}

float sdWing(vec3 p) {
  const float chord = 0.6;
  const float halfSpan = 0.42;
  float d2 = airfoil(vec2(p.x / chord + 0.3, p.y / chord)) * chord;
  vec2 w = vec2(d2, abs(p.z) - halfSpan);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
}

// A small streamlined car, 0.8 long, with its wheels touching y = -0.14.
float sdCar(vec3 p) {
  float body = sdBox(p - vec3(0.0, -0.035, 0.0), vec3(0.4, 0.05, 0.16), 0.045);
  vec3 c = p - vec3(-0.04, 0.0, 0.0);
  vec3 radii = vec3(0.27, 0.115, 0.135);
  float k0 = length(c / radii);
  float cabin = k0 * (k0 - 1.0) / length(c / (radii * radii));
  cabin = max(cabin, -p.y - 0.01);
  float d = smin(body, cabin, 0.06);
  vec3 w = vec3(abs(p.x) - 0.25, p.y + 0.075, abs(p.z) - 0.145);
  float wheels = sdCylinderZ(w, 0.065, 0.035);
  return min(d, wheels);
}

float sdObjectLocal(vec3 p) {
  if (uShape == 0) return length(p) - 0.2;
  if (uShape == 1) return sdCylinderZ(p, 0.11, 4.0);
  if (uShape == 2) return sdBox(p, vec3(0.15), 0.01);
  if (uShape == 3) return sdWing(p);
  return sdCar(p);
}

float obstacleSdf(vec3 world) {
  vec3 p = uObsRot * (world - uObsPos) / uObsScale;
  float d = sdObjectLocal(p) * uObsScale;
  return max(d, sdBox(world, uTunnelHalf, 0.0));
}

vec3 obstacleNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0015;
  return normalize(k.xyy * obstacleSdf(p + k.xyy * h) + k.yyx * obstacleSdf(p + k.yyx * h)
    + k.yxy * obstacleSdf(p + k.yxy * h) + k.xxx * obstacleSdf(p + k.xxx * h));
}

// Sphere-traces the object between tMin and tMax, first clipping to its bounding sphere.
bool traceObstacle(vec3 ro, vec3 rd, float tMin, float tMax, out float tHit) {
  vec3 oc = ro - uObsPos;
  float b = dot(oc, rd);
  float h = b * b - dot(oc, oc) + uObsBound * uObsBound;
  if (h < 0.0) return false;
  h = sqrt(h);
  float t = max(tMin, -b - h);
  tMax = min(tMax, -b + h);
  for (int i = 0; i < 128; i++) {
    if (t > tMax) return false;
    float d = obstacleSdf(ro + rd * t);
    if (d < 0.0006) {
      tHit = t;
      return true;
    }
    t += max(d * 0.8, 0.0008);
  }
  return false;
}

// Soft shadow from the object towards the light.
float obstacleShadow(vec3 ro, vec3 rd) {
  vec3 oc = ro - uObsPos;
  float b = dot(oc, rd);
  float h = b * b - dot(oc, oc) + uObsBound * uObsBound;
  if (h < 0.0) return 1.0;
  h = sqrt(h);
  float t = max(0.002, -b - h);
  float tMax = -b + h;
  float shadow = 1.0;
  for (int i = 0; i < 64; i++) {
    if (t > tMax) break;
    float d = obstacleSdf(ro + rd * t);
    shadow = min(shadow, 10.0 * d / t);
    if (shadow < 0.01) return 0.0;
    t += clamp(d, 0.004, 0.08);
  }
  return clamp(shadow, 0.0, 1.0);
}
