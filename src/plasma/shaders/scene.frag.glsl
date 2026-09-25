uniform vec4 uEnds[MAX_FILAMENTS]; // xyz = direction of the end on the glass, w = brightness
uniform vec4 uRoots[MAX_FILAMENTS]; // xyz = direction where it leaves the electrode, w = brightness
uniform vec3 uSpotColors[MAX_FILAMENTS];
uniform vec3 uGas; // colour of the glowing gas, scaled by the voltage
uniform vec3 uGlow; // colour and strength of the light the globe casts on the room

in vec2 vUv;
out vec4 outColor;

const float NO_HIT = 1e4;

float sdCappedCone(vec3 p, float h, float r1, float r2) {
  vec2 q = vec2(length(p.xz), p.y);
  vec2 k1 = vec2(r2, h);
  vec2 k2 = vec2(r2 - r1, 2.0 * h);
  vec2 ca = vec2(q.x - min(q.x, q.y < 0.0 ? r1 : r2), abs(q.y) - h);
  vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
  float s = cb.x < 0.0 && ca.y < 0.0 ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}

float sdBase(vec3 p) {
  const float ROUND = 0.03;
  float h = (BASE_TOP - FLOOR_Y) * 0.5;
  vec3 q = p - vec3(0.0, FLOOR_Y + h, 0.0);
  float body = sdCappedCone(q, h - ROUND, BASE_BOTTOM_R - ROUND, BASE_TOP_R - ROUND) - ROUND;
  // A groove around the base, a little above the table.
  float groove = length(vec2(length(p.xz) - mix(BASE_BOTTOM_R, BASE_TOP_R, 0.22), p.y - FLOOR_Y - 0.16)) - 0.018;
  return max(body, -groove);
}

float traceBase(vec3 ro, vec3 rd) {
  // Only march rays that pass through the base's bounding cylinder.
  float b = dot(ro.xz, rd.xz);
  float a = dot(rd.xz, rd.xz);
  float c = dot(ro.xz, ro.xz) - BASE_BOTTOM_R * BASE_BOTTOM_R;
  float h = b * b - a * c;
  if (h < 0.0 || a < 1e-6) return NO_HIT;
  h = sqrt(h);
  float t = max((-b - h) / a, 0.0);
  float tEnd = (-b + h) / a;
  if (tEnd < 0.0) return NO_HIT;
  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    if (p.y > BASE_TOP + 0.01 && rd.y >= 0.0) return NO_HIT;
    float d = sdBase(p);
    if (d < 0.0005) return t;
    t += d;
    if (t > tEnd) return NO_HIT;
  }
  return NO_HIT;
}

vec3 baseNormal(vec3 p) {
  const vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    sdBase(p + e.xyy) - sdBase(p - e.xyy),
    sdBase(p + e.yxy) - sdBase(p - e.yxy),
    sdBase(p + e.yyx) - sdBase(p - e.yyx)));
}

// The globe seen as a blurry glowing ball, for glossy reflections of it.
vec3 globeGlow(vec3 ro, vec3 rd) {
  float tc = max(-dot(ro, rd), 0.0);
  vec3 c = ro + rd * tc;
  return uGlow * exp(-dot(c, c) * 2.0);
}

// Light from the discharge reaching a point, treating the globe as a light at its centre.
vec3 globeLight(vec3 p, vec3 n) {
  vec3 l = -p;
  float d2 = dot(l, l);
  return uGlow * max(dot(n, l * inversesqrt(d2)), 0.0) / d2;
}

float fresnel(float cosI, float f0) {
  return f0 + (1.0 - f0) * pow(1.0 - clamp(cosI, 0.0, 1.0), 5.0);
}

vec3 shadeFloor(vec3 p, vec3 rd) {
  vec2 grain = p.xz * vec2(3.0, 28.0);
  float wood = 0.75 + 0.25 * noise3(vec3(grain, 0.0)) + 0.1 * noise3(vec3(grain * 4.0, 1.0));
  vec3 albedo = vec3(0.09, 0.055, 0.035) * wood;
  // The base blocks the light from the globe close around it.
  float crossR = length(p.xz) * (-BASE_TOP) / (-FLOOR_Y);
  float shadow = smoothstep(BASE_TOP_R - 0.05, BASE_TOP_R + 0.12, crossR);
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 col = albedo * (globeLight(p, n) * shadow * 1.5 + vec3(0.01, 0.012, 0.02));
  vec3 r = reflect(rd, n);
  float f = fresnel(-rd.y, 0.03);
  col += f * (roomEnv(r) + globeGlow(p, r) * 0.6 * shadow);
  return col;
}

vec3 shadeBase(vec3 p, vec3 rd) {
  vec3 n = baseNormal(p);
  vec3 r = reflect(rd, n);
  float f = fresnel(dot(-rd, n), 0.05);
  vec3 col = vec3(0.012) * (globeLight(p, n) + vec3(0.02));
  col += f * (roomEnv(r) * 1.5 + globeGlow(p, r) * 0.8);
  // Brushed metal band around the top, where the globe sits. The top face under the glass stays black.
  float band = smoothstep(BASE_TOP - 0.07, BASE_TOP - 0.05, p.y) * (1.0 - smoothstep(0.4, 0.7, n.y));
  vec3 metal = vec3(0.5, 0.5, 0.55) * (roomEnv(r) * 2.0 + globeGlow(p, r) * 1.2 + globeLight(p, n) * 0.3);
  return mix(col, metal, band);
}

vec3 shadeElectrode(vec3 p, vec3 rd, vec3 gas) {
  vec3 n = p / ELECTRODE_RADIUS;
  float swirl = noise3(n * 5.0 + vec3(0.0, uTime * 1.3, 0.0)) * 0.6 + noise3(n * 11.0 - uTime * 2.0) * 0.4;
  vec3 col = gas * (0.9 + 1.4 * swirl);
  for (int i = 0; i < MAX_FILAMENTS; i++) {
    float w = uRoots[i].w;
    if (w <= 0.0) continue;
    float d = 1.0 - dot(n, uRoots[i].xyz);
    col += mix(uSpotColors[i], vec3(1.0), 0.6) * w * (exp(-d * 40.0) * 5.0 + exp(-d * 6.0) * 0.6);
  }
  float rim = 1.0 - abs(dot(n, rd));
  return col * (0.7 + 0.8 * rim);
}

vec3 glassSpots(vec3 p) {
  vec3 n = normalize(p);
  vec3 col = vec3(0.0);
  for (int i = 0; i < MAX_FILAMENTS; i++) {
    float w = uEnds[i].w;
    if (w <= 0.0) continue;
    float d = 1.0 - dot(n, uEnds[i].xyz);
    col += uSpotColors[i] * w * (exp(-d * 2500.0) * 3.0 + exp(-d * 250.0) * 0.5 + exp(-d * 30.0) * 0.04);
  }
  return col;
}

// Glow of the thin gas, strongest around the electrode: a Gaussian integrated along the ray.
vec3 haze(vec3 ro, vec3 rd, float t0, float t1, vec3 gas) {
  const float S = 0.38;
  float tc = -dot(ro, rd);
  float d2 = max(dot(ro, ro) - tc * tc, 0.0);
  float a = (t0 - tc) / S;
  float b = (t1 - tc) / S;
  // erf(x) ~ tanh(1.2 x), close enough for a glow.
  float g = exp(-d2 / (S * S)) * S * 0.886 * (tanh(1.2 * b) - tanh(1.2 * a));
  return gas * (g * 0.35 + (t1 - t0) * 0.012);
}

void main() {
  vec3 rd = cameraRay(vUv);
  vec3 ro = uCameraWorld[3].xyz;
  vec3 gas = uGas;

  vec3 color = roomEnv(rd);
  float depth = NO_HIT;

  if (rd.y < 0.0) {
    float tf = (FLOOR_Y - ro.y) / rd.y;
    depth = tf;
    color = shadeFloor(ro + rd * tf, rd);
  }
  float tb = traceBase(ro, rd);
  if (tb < depth) {
    depth = tb;
    color = shadeBase(ro + rd * tb, rd);
  }

  vec2 g = sphereHit(ro, rd, GLASS_RADIUS);
  if (g.y > 0.0 && g.x < depth) {
    float tIn = max(g.x, 0.0);
    float inner = min(g.y, depth);

    // The glass stem that holds the electrode.
    float a = dot(rd.xz, rd.xz);
    float b = dot(ro.xz, rd.xz);
    float h = b * b - a * (dot(ro.xz, ro.xz) - STEM_R * STEM_R);
    if (h > 0.0 && a > 1e-6) {
      float ts = (-b - sqrt(h)) / a;
      float y = ro.y + rd.y * ts;
      if (ts > tIn && ts < inner && y > BASE_TOP && y < 0.0) {
        inner = ts;
        depth = ts;
        vec3 n = normalize(vec3((ro + rd * ts).x, 0.0, (ro + rd * ts).z));
        float glow = smoothstep(BASE_TOP, -ELECTRODE_RADIUS, y);
        color = gas * (0.03 + 0.5 * glow * glow) + roomEnv(reflect(rd, n)) * fresnel(dot(-rd, n), 0.04);
      }
    }

    vec2 e = sphereHit(ro, rd, ELECTRODE_RADIUS);
    if (e.x > tIn && e.x < inner) {
      inner = e.x;
      depth = e.x;
      color = shadeElectrode(ro + rd * e.x, rd, gas);
    }

    color += haze(ro, rd, tIn, inner, gas);
    if (g.y < depth) color += glassSpots(ro + rd * g.y);
    if (g.x > 0.0 && g.x < depth) color += glassSpots(ro + rd * g.x);
  }

  outColor = vec4(color, min(depth, 1000.0));
}
