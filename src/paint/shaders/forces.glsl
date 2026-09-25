uniform sampler2D uVel;
uniform sampler2D uCurl;
uniform sampler2D uDye;
uniform float uDt;
uniform float uVorticity;
uniform float uSink; // downward acceleration per unit of paint concentration (cells/s^2)

out vec4 outVel;

// Vorticity confinement (restores small swirls lost to numerical diffusion), negative buoyancy
// of the heavier paint, and the velocity of the pour and stir sources.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c)) {
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

  v.y -= uSink * fetch(uDye, c).a * uDt;

  for (int i = 0; i < MAX_SOURCES; i++) {
    if (i >= uSourceCount) break;
    v = mix(v, uSourceVel[i], clamp(sourceWeight(i, p) * 1.5, 0.0, 1.0));
  }
  outVel = vec4(v, 0.0);
}
