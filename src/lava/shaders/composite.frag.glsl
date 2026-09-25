uniform vec4 uBlobs[MAX_BLOBS]; // centre, radius
uniform vec4 uBlobShape[MAX_BLOBS]; // horizontal scale, vertical scale, temperature, neck radius
uniform int uBlobCount;
uniform vec4 uPool; // surface height, temperature, time
uniform sampler2D uScene;
uniform vec3 uLiquidColor; // colour of the liquid, linear
uniform float uBrightness; // how bright the bulb is
uniform float uExposure;

in vec2 vUv;
out vec4 outColor;

const vec3 BULB = vec3(0.0, LAMP_BOTTOM - 0.06, 0.0);
const float BLEND = 0.035; // how far apart wax surfaces start to flow together
const int MAX_NEAR = 8;

vec3 finish(vec3 c) {
  return pow(aces(c * uExposure), vec3(1.0 / 2.2));
}

/** How brightly the liquid glows at height y: the bulb shines up from below. */
float glowAt(float y) {
  return uBrightness * (0.25 + 1.3 * exp(-(y - LAMP_BOTTOM) * 2.6));
}

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float ellipsoidSDF(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}

float capsuleSDF(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// The blobs this pixel's ray passes near; only these are evaluated while marching.
int nearBlobs[MAX_NEAR];
int nearCount = 0;

float poolSDF(vec3 p) {
  float time = uPool.z;
  float wave = 0.003 * sin(p.x * 31.0 + time * 0.7) * sin(p.z * 27.0 - time * 0.5);
  return max(p.y - uPool.x - wave, vesselSDF(p, -0.001));
}

float blobSDF(int i, vec3 p) {
  vec4 b = uBlobs[i];
  vec4 s = uBlobShape[i];
  float d = ellipsoidSDF(p - b.xyz, vec3(s.x, s.y, s.x) * b.w);
  if (s.w > 0.001) d = smin(d, capsuleSDF(p, vec3(b.x, uPool.x - 0.03, b.z), b.xyz, s.w), 0.04);
  return d;
}

float waxSDF(vec3 p) {
  float d = poolSDF(p);
  for (int k = 0; k < MAX_NEAR; k++) {
    if (k >= nearCount) break;
    d = smin(d, blobSDF(nearBlobs[k], p), BLEND);
  }
  return max(d, vesselSDF(p, -0.001));
}

vec3 waxNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.0015;
  return normalize(k.xyy * waxSDF(p + k.xyy * e) + k.yyx * waxSDF(p + k.yyx * e) +
    k.yxy * waxSDF(p + k.yxy * e) + k.xxx * waxSDF(p + k.xxx * e));
}

/** Temperature at a point on the wax: that of the nearest blobs (or the pool), blended. */
float waxTemperature(vec3 p) {
  float w = exp(-max(poolSDF(p), 0.0) * 80.0);
  float sum = w * uPool.y;
  float total = w;
  for (int k = 0; k < MAX_NEAR; k++) {
    if (k >= nearCount) break;
    float wk = exp(-max(blobSDF(nearBlobs[k], p), 0.0) * 80.0);
    sum += wk * uBlobShape[nearBlobs[k]].z;
    total += wk;
  }
  return sum / max(total, 1e-4);
}

bool rayNear(vec3 ro, vec3 rd, vec3 c, float radius, float t0, float t1) {
  vec3 oc = c - ro;
  float tc = dot(oc, rd);
  float d2 = dot(oc, oc) - tc * tc;
  return d2 < radius * radius && tc > t0 - radius && tc < t1 + radius;
}

void findNearBlobs(vec3 ro, vec3 rd, float t0, float t1) {
  for (int i = 0; i < MAX_BLOBS; i++) {
    if (i >= uBlobCount || nearCount >= MAX_NEAR) break;
    vec4 b = uBlobs[i];
    vec4 s = uBlobShape[i];
    float reach = max(s.x, s.y) * b.w + BLEND;
    bool near = rayNear(ro, rd, b.xyz, reach, t0, t1);
    if (!near && s.w > 0.001) {
      vec3 base = vec3(b.x, uPool.x - 0.03, b.z);
      near = rayNear(ro, rd, 0.5 * (base + b.xyz), 0.5 * distance(base, b.xyz) + s.w + BLEND, t0, t1);
    }
    if (near) nearBlobs[nearCount++] = i;
  }
}

vec3 vesselNormal(vec3 p, float grow) {
  const vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    vesselSDF(p + e.xyy, grow) - vesselSDF(p - e.xyy, grow),
    vesselSDF(p + e.yxy, grow) - vesselSDF(p - e.yxy, grow),
    vesselSDF(p + e.yyx, grow) - vesselSDF(p - e.yyx, grow)));
}

// The wax is lit by the bulb underneath: undersides and thin parts glow, hot wax glows more, the
// tops pick up the light of the liquid around them, and the wet surface has a soft sheen.
vec3 shadeWax(vec3 wp, vec3 n, vec3 rd, float thickness, float temperature) {
  vec3 toBulb = BULB - wp;
  float dist = length(toBulb);
  vec3 l = toBulb / dist;
  float bulb = uBrightness * 1.1 / (1.0 + 16.0 * dist * dist);
  float wrap = max(dot(n, l) * 0.5 + 0.5, 0.0);
  // Wax right over the bulb glows yellow; elsewhere it's the saturated wax colour.
  float hot = smoothstep(0.55, 0.95, temperature) * exp(-max(wp.y - LAMP_BOTTOM, 0.0) * 5.0);
  vec3 body = mix(uWaxColor, mix(uWaxColor, vec3(1.0, 0.75, 0.2), 0.6), hot);
  float cosV = clamp(dot(n, -rd), 0.0, 1.0);
  // Light scatters inside the wax, so blobs are brighter through the middle than at the rim.
  float scatter = 0.45 + 0.55 * cosV;
  vec3 col = body * (0.6 * uBrightness + bulb * wrap * 0.7 + hot * 0.35 * uBrightness) * scatter;
  col += uWaxColor * bulb * exp(-thickness * 12.0) * 0.5;
  float fresnel = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  col += uLiquidColor * glowAt(wp.y) * fresnel * 0.3;
  return col;
}

void main() {
  vec3 rd = cameraRay(vUv);
  vec3 ro = uCameraWorld[3].xyz;
  float toDepth = dot(rd, -mat3(uCameraWorld)[2]);
  vec4 scene = texture(uScene, vUv);
  float sceneT = scene.a > 0.0 ? scene.a / toDepth : 1e9;

  // Find the outside of the glass.
  float t = max(length(ro) - 1.3, 0.0);
  bool hit = false;
  for (int i = 0; i < 80; i++) {
    float d = vesselSDF(ro + rd * t, GLASS);
    if (d < 0.0005) {
      hit = true;
      break;
    }
    t += d;
    if (t > sceneT || t > 12.0) break;
  }
  if (!hit || t > sceneT) {
    outColor = vec4(finish(scene.rgb), 1.0);
    return;
  }
  float tFront = t;
  vec3 nFront = vesselNormal(ro + rd * tFront, GLASS);

  // Into the liquid, and out the other side.
  bool inside = false;
  for (int i = 0; i < 24; i++) {
    float d = vesselSDF(ro + rd * t, 0.0);
    if (d < 0.0005) {
      inside = true;
      break;
    }
    t += max(d, 0.001);
    if (vesselSDF(ro + rd * t, GLASS) > 0.0) break;
  }
  float tEnter = t;
  float tBack = tEnter;
  if (inside) {
    t += 0.002;
    for (int i = 0; i < 64; i++) {
      float d = vesselSDF(ro + rd * t, 0.0);
      if (d > -0.0005) break;
      t += max(-d, 0.003);
    }
    tBack = t;
  }

  // March the wax through the liquid.
  vec3 behind = scene.rgb;
  float tEnd = tBack;
  if (inside) {
    findNearBlobs(ro, rd, tEnter, tBack);
    float tw = tEnter;
    bool waxHit = false;
    for (int i = 0; i < 100; i++) {
      float d = waxSDF(ro + rd * tw);
      if (d < 0.0007) {
        waxHit = true;
        break;
      }
      tw += max(d * 0.9, 0.0015);
      if (tw > tBack) break;
    }
    if (waxHit) {
      tEnd = tw;
      vec3 wp = ro + rd * tEnd;
      // How much wax the light behind this point has to get through.
      float tIn = tEnd + 0.003;
      for (int i = 0; i < 16; i++) {
        float d = waxSDF(ro + rd * tIn);
        if (d > 0.0 || tIn > tBack) break;
        tIn += max(-d, 0.004);
      }
      float thickness = min(tIn, tBack) - tEnd;
      behind = shadeWax(wp, waxNormal(wp), rd, thickness, waxTemperature(wp));
    }
  }

  // The glowing liquid tints what's behind it and adds its own light along the way.
  float path = inside ? tEnd - tEnter : 0.0;
  float glow = 0.0;
  for (int i = 0; i < 4; i++) glow += glowAt((ro + rd * mix(tEnter, tEnd, (float(i) + 0.5) / 4.0)).y);
  glow *= 0.25;
  vec3 absorb = (1.0 - uLiquidColor) * 1.5 + 0.15;
  vec3 col = behind * exp(-absorb * path) + uLiquidColor * glow * 0.45 * (1.0 - exp(-path * 3.0));

  // Glass: darker where it's seen edge-on, and reflecting the room.
  float cosTheta = clamp(dot(nFront, -rd), 0.0, 1.0);
  col *= mix(0.65, 1.0, smoothstep(0.0, 0.5, cosTheta));
  float fresnel = 0.04 + 0.96 * pow(1.0 - cosTheta, 5.0);
  vec3 refl = reflect(rd, nFront);
  col = mix(col, environment(refl) * 2.0, fresnel);
  col += vec3(0.9, 0.9, 1.0) * pow(max(dot(refl, normalize(vec3(-0.8, 0.35, 0.5))), 0.0), 200.0) * 0.12;
  outColor = vec4(finish(col), 1.0);
}
