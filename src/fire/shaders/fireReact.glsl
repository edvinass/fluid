uniform sampler2D uVel;
uniform sampler2D uState; // at the start of the step: r = temperature, g = smoke, b = fuel
uniform sampler2D uForward;
uniform sampler2D uBackward;
uniform float uDt;
uniform float uIgnition;
uniform float uBurnRate;
uniform float uHeatRelease;
uniform float uSoot;
uniform float uCooling;
uniform float uSmokeFade;

out vec4 outState;

// MacCormack advection of temperature, smoke and fuel (see paint's dyeCorrect), then the emitters
// and combustion: hot fuel burns, releasing heat and soot, and the gas cools as it rises.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c) || isSolid(c)) {
    outState = vec4(0.0);
    return;
  }
  vec3 p = vec3(c) + 0.5;
  vec3 v = fetch(uVel, c).xyz;
  vec3 mid = p - 0.5 * uDt * v;
  vec3 back = clamp(p - uDt * sample3D(uVel, mid).xyz, vec3(0.5), vec3(uRes) - 0.5);

  vec4 corrected = fetch(uForward, c) + 0.5 * (fetch(uState, c) - fetch(uBackward, c));
  ivec3 base = ivec3(floor(back - 0.5));
  vec4 lo = vec4(1e9);
  vec4 hi = vec4(-1e9);
  for (int k = 0; k < 8; k++) {
    vec4 s = fetch(uState, base + ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1));
    lo = min(lo, s);
    hi = max(hi, s);
  }
  vec4 s = clamp(corrected, lo, hi);
  float temperature = s.r;
  float smoke = s.g;
  float fuel = s.b;

  vec3 world = p * uCellSize;
  for (int i = 0; i < MAX_EMITTERS; i++) {
    if (i >= uEmitCount) break;
    float w = emitWeight(i, p) * uDt;
    if (w < 1e-5) continue;
    float n = noise3(world * 9.0 + vec3(0.0, -uTime * 4.0, uTime * 0.9)) * 0.65
      + noise3(world * 23.0 + vec3(uTime * 1.3, -uTime * 7.0, 0.0)) * 0.35;
    float flicker = mix(1.0, smoothstep(0.25, 0.75, n) * 2.2, uEmitRate[i].w);
    fuel += uEmitRate[i].x * w * flicker;
    temperature += uEmitRate[i].y * w * flicker;
    smoke += uEmitRate[i].z * w;
  }

  float burn = temperature > uIgnition ? fuel * (1.0 - exp(-uBurnRate * uDt)) : 0.0;
  fuel -= burn;
  temperature += burn * uHeatRelease;
  smoke += burn * uSoot;
  temperature *= exp(-uCooling * uDt * (0.4 + temperature));
  smoke *= exp(-uSmokeFade * uDt);

  outState = vec4(min(temperature, 6.0), min(smoke, 3.0), clamp(fuel, 0.0, 3.0), 0.0);
}
