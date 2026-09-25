uniform sampler2D uVel;
uniform sampler2D uDye; // dye at the start of the step
uniform sampler2D uForward; // dye advected forward
uniform sampler2D uBackward; // forward result advected backward again
uniform float uDt;
uniform float uDissipation;

out vec4 outDye;

// MacCormack correction: cancels most of the numerical blur of plain semi-Lagrangian advection,
// keeping paint filaments crisp. The result is clamped to the values it was interpolated from
// so it can't overshoot. Also injects paint from the pour sources.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c)) {
    outDye = vec4(0.0);
    return;
  }
  vec3 p = vec3(c) + 0.5;
  vec3 v = fetch(uVel, c).xyz;
  vec3 mid = p - 0.5 * uDt * v;
  vec3 back = clamp(p - uDt * sample3D(uVel, mid).xyz, vec3(0.5), vec3(uRes) - 0.5);

  vec4 forward = fetch(uForward, c);
  vec4 corrected = forward + 0.5 * (fetch(uDye, c) - fetch(uBackward, c));

  ivec3 base = ivec3(floor(back - 0.5));
  vec4 lo = vec4(1e9);
  vec4 hi = vec4(-1e9);
  for (int k = 0; k < 8; k++) {
    vec4 s = fetch(uDye, base + ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1));
    lo = min(lo, s);
    hi = max(hi, s);
  }
  vec4 dye = clamp(corrected, lo, hi) * uDissipation;

  for (int i = 0; i < MAX_SOURCES; i++) {
    if (i >= uSourceCount) break;
    float amount = uSourceColor[i].a;
    if (amount <= 0.0) continue;
    float w = sourceWeight(i, p) * amount * uDt;
    dye += vec4(uSourceColor[i].rgb, 1.0) * w;
  }
  // Keep concentration bounded while preserving the mixed colour.
  if (dye.a > 2.0) dye *= 2.0 / dye.a;
  outDye = max(dye, vec4(0.0));
}
