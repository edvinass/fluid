uniform sampler2D uDepth;
uniform sampler2D uThickness;
uniform sampler2D uScene;
uniform float uThicknessScale;
uniform vec3 uLiquidColor; // colour of the liquid, linear
uniform float uBrightness; // how bright the bulb is
uniform float uExposure;

in vec2 vUv;
out vec4 outColor;

const vec3 BULB = vec3(0.0, LAMP_BOTTOM - 0.06, 0.0);

vec3 finish(vec3 c) {
  return pow(aces(c * uExposure), vec3(1.0 / 2.2));
}

/** How brightly the liquid glows at height y: the bulb shines up from below. */
float glowAt(float y) {
  return uBrightness * (0.25 + 1.3 * exp(-(y - LAMP_BOTTOM) * 2.6));
}

vec3 viewPosAt(ivec2 p, vec2 invSize) {
  float depth = texelFetch(uDepth, p, 0).r;
  vec2 ndc = (vec2(p) + 0.5) * invSize * 2.0 - 1.0;
  return vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0) * depth;
}

vec3 waxNormal(ivec2 p, vec2 size) {
  vec2 invSize = 1.0 / size;
  vec3 pos = viewPosAt(p, invSize);
  ivec2 maxP = ivec2(size) - 1;
  ivec2 px1 = min(p + ivec2(1, 0), maxP), px0 = max(p - ivec2(1, 0), ivec2(0));
  ivec2 py1 = min(p + ivec2(0, 1), maxP), py0 = max(p - ivec2(0, 1), ivec2(0));
  float dxr = texelFetch(uDepth, px1, 0).r, dxl = texelFetch(uDepth, px0, 0).r;
  float dyu = texelFetch(uDepth, py1, 0).r, dyd = texelFetch(uDepth, py0, 0).r;
  vec3 ddx = viewPosAt(px1, invSize) - pos;
  vec3 ddx2 = pos - viewPosAt(px0, invSize);
  if (dxr <= 0.0 || (dxl > 0.0 && abs(ddx2.z) < abs(ddx.z))) ddx = ddx2;
  vec3 ddy = viewPosAt(py1, invSize) - pos;
  vec3 ddy2 = pos - viewPosAt(py0, invSize);
  if (dyu <= 0.0 || (dyd > 0.0 && abs(ddy2.z) < abs(ddy.z))) ddy = ddy2;
  return normalize(mat3(uCameraWorld) * normalize(cross(ddx, ddy)));
}

vec3 vesselNormal(vec3 p, float grow) {
  const vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    vesselSDF(p + e.xyy, grow) - vesselSDF(p - e.xyy, grow),
    vesselSDF(p + e.yxy, grow) - vesselSDF(p - e.yxy, grow),
    vesselSDF(p + e.yyx, grow) - vesselSDF(p - e.yyx, grow)));
}

// The wax glows: the bulb shines up through it, so thin parts and edges light up, and the
// surface picks up the colour of the glowing liquid around it.
vec3 shadeWax(vec3 wp, vec3 n, vec3 rd, float thickness) {
  vec3 toBulb = BULB - wp;
  float dist = length(toBulb);
  float bulb = uBrightness * 1.8 / (1.0 + 12.0 * dist * dist);
  float facing = max(dot(n, toBulb / dist), 0.0) * 0.75 + 0.25;
  vec3 through = uWaxColor * bulb * exp(-thickness * 10.0) * 1.4;
  vec3 lit = uWaxColor * (bulb * facing + uLiquidColor * glowAt(wp.y) * 0.4);
  float fresnel = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
  return lit + through + uWaxColor * 0.04 + uLiquidColor * glowAt(wp.y) * fresnel * 0.35;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 size = vec2(textureSize(uDepth, 0));
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

  vec3 behind = scene.rgb;
  float tEnd = tBack;
  float depth = texelFetch(uDepth, p, 0).r;
  if (inside && depth > 0.0 && depth / toDepth < tBack + 0.01) {
    tEnd = max(depth / toDepth, tEnter);
    vec3 wp = ro + rd * tEnd;
    float thickness = texture(uThickness, vUv).r * uThicknessScale;
    behind = shadeWax(wp, waxNormal(p, size), rd, thickness);
  }

  // The glowing liquid tints what's behind it and adds its own light along the way.
  float path = inside ? tEnd - tEnter : 0.0;
  float glow = 0.0;
  for (int i = 0; i < 4; i++) glow += glowAt((ro + rd * mix(tEnter, tEnd, (float(i) + 0.5) / 4.0)).y);
  glow *= 0.25;
  vec3 absorb = (1.0 - uLiquidColor) * 2.5 + 0.3;
  vec3 col = behind * exp(-absorb * path) + uLiquidColor * glow * (1.0 - exp(-path * 3.0));

  // Glass: darker where it's seen edge-on, and reflecting the room.
  float cosTheta = clamp(dot(nFront, -rd), 0.0, 1.0);
  col *= mix(0.65, 1.0, smoothstep(0.0, 0.5, cosTheta));
  float fresnel = 0.04 + 0.96 * pow(1.0 - cosTheta, 5.0);
  vec3 refl = reflect(rd, nFront);
  col = mix(col, environment(refl) * 2.0, fresnel);
  col += vec3(0.9, 0.9, 1.0) * pow(max(dot(refl, normalize(vec3(-0.8, 0.35, 0.5))), 0.0), 60.0) * 0.5;
  outColor = vec4(finish(col), 1.0);
}
