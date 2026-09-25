uniform sampler2D uVel;
uniform sampler2D uCurl;
uniform sampler2D uState; // r = temperature, g = smoke, b = fuel
uniform float uDt;
uniform float uVorticity;
uniform float uBuoyancy; // cells/s^2 per unit of temperature
uniform float uWeight; // cells/s^2 per unit of smoke
uniform vec2 uBreeze; // horizontal wind, cells/s
uniform float uBreezeRate;

out vec4 outVel;

// Hot gas rises and soot sinks; vorticity confinement keeps the flames licking and curling.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c) || isSolid(c)) {
    outVel = vec4(0.0);
    return;
  }
  vec3 p = vec3(c) + 0.5;
  vec3 v = fetch(uVel, c).xyz;
  vec3 w = fetch(uCurl, c).xyz;
  vec3 grad = 0.5 * vec3(
    fetch(uCurl, c + ivec3(1, 0, 0)).w - fetch(uCurl, c - ivec3(1, 0, 0)).w,
    fetch(uCurl, c + ivec3(0, 1, 0)).w - fetch(uCurl, c - ivec3(0, 1, 0)).w,
    fetch(uCurl, c + ivec3(0, 0, 1)).w - fetch(uCurl, c - ivec3(0, 0, 1)).w);
  float gradLen = length(grad);
  if (gradLen > 1e-5) v += uVorticity * cross(grad / gradLen, w) * uDt;

  vec4 state = fetch(uState, c);
  v.y += (uBuoyancy * state.r - uWeight * state.g) * uDt;
  v.xz += (uBreeze - v.xz) * (1.0 - exp(-uBreezeRate * uDt));

  for (int i = 0; i < MAX_EMITTERS; i++) {
    if (i >= uEmitCount) break;
    float strength = uEmitVel[i].w;
    if (strength <= 0.0) continue;
    v = mix(v, emitVelocity(i, p), clamp(emitWeight(i, p) * strength, 0.0, 1.0));
  }
  outVel = vec4(v, 0.0);
}
