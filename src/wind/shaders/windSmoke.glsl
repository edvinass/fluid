uniform sampler2D uVel;
uniform sampler2D uDye; // smoke at the start of the step
uniform sampler2D uForward; // smoke advected forward
uniform sampler2D uBackward; // forward result advected backward again
uniform float uDt;
uniform float uDissipation;

uniform ivec2 uRakeCount; // streams along y and z (0 = rake off)
uniform vec4 uRakeRange; // yMin, yMax, zMin, zMax in cells
uniform float uRakeRadius; // cells
uniform float uRakeAmount;
uniform int uRainbow;
uniform float uPulse; // pulses per second, 0 for continuous streams
uniform vec4 uWand; // xyz = position in cells, w = radius (0 = off)
uniform vec3 uWandColor;

out vec4 outDye;

vec3 hue(float h) {
  return clamp(abs(fract(h + vec3(0.0, 2.0, 1.0) / 3.0) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}

// Centre of the nearest stream along one axis, and its index normalised to 0..1.
vec2 nearestStream(float p, float lo, float hi, int count) {
  if (count <= 1) return vec2(0.5 * (lo + hi), 0.5);
  float spacing = (hi - lo) / float(count - 1);
  float i = clamp(floor((p - lo) / spacing + 0.5), 0.0, float(count - 1));
  return vec2(lo + i * spacing, i / float(count - 1));
}

// MacCormack advection of the smoke (see paint's dyeCorrect), then the rake at the inlet and the
// hand-held smoke wand.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c) || isSolid(c)) {
    outDye = vec4(0.0);
    return;
  }
  vec3 p = vec3(c) + 0.5;
  vec3 v = fetch(uVel, c).xyz;
  vec3 mid = p - 0.5 * uDt * v;
  vec3 back = clamp(p - uDt * sample3D(uVel, mid).xyz, vec3(0.5), vec3(uRes) - 0.5);

  vec4 corrected = fetch(uForward, c) + 0.5 * (fetch(uDye, c) - fetch(uBackward, c));
  ivec3 base = ivec3(floor(back - 0.5));
  vec4 lo = vec4(1e9);
  vec4 hi = vec4(-1e9);
  for (int k = 0; k < 8; k++) {
    vec4 s = fetch(uDye, base + ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1));
    lo = min(lo, s);
    hi = max(hi, s);
  }
  vec4 dye = clamp(corrected, lo, hi) * uDissipation;

  // The inlet slice only ever sees its own value upstream, so it's set outright rather than mixed.
  if (c.x == 0) dye = vec4(0.0);
  if (c.x == 0 && uRakeCount.x > 0 && uRakeCount.y > 0) {
    vec2 sy = nearestStream(p.y, uRakeRange.x, uRakeRange.y, uRakeCount.x);
    vec2 sz = nearestStream(p.z, uRakeRange.z, uRakeRange.w, uRakeCount.y);
    vec2 d = p.yz - vec2(sy.x, sz.x);
    float w = exp(-dot(d, d) / (uRakeRadius * uRakeRadius));
    float amount = uRakeAmount;
    if (uPulse > 0.0) amount *= step(0.4, fract(uTime * uPulse));
    vec3 color = uRainbow == 1 ? hue(0.78 * (uRakeCount.x > 1 ? 1.0 - sy.y : sz.y)) * 0.9 + 0.1 : vec3(1.0);
    dye = vec4(color, 1.0) * amount * w;
  }
  if (uWand.w > 0.0) {
    vec3 d = p - uWand.xyz;
    float w = exp(-dot(d, d) / (uWand.w * uWand.w));
    dye = mix(dye, vec4(uWandColor, 1.0) * uRakeAmount, clamp(w * 1.5, 0.0, 1.0));
  }
  outDye = max(dye, vec4(0.0));
}
