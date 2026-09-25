uniform sampler2D uVel;
uniform sampler2D uCurl;
uniform float uDt;
uniform float uVorticity;

out vec4 outVel;

// Vorticity confinement, which keeps the wake's eddies from being smeared away by numerical
// diffusion, plus the inflow and the moving object.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c)) {
    outVel = vec4(0.0);
    return;
  }
  vec4 obstacle = fetch(uObstacle, c);
  if (obstacle.w < 0.0) {
    outVel = vec4(obstacle.xyz, 0.0);
    return;
  }
  if (c.x == 0) {
    outVel = vec4(inflow(c), 0.0);
    return;
  }
  vec3 v = fetch(uVel, c).xyz;
  vec3 w = fetch(uCurl, c).xyz;
  vec3 grad = 0.5 * vec3(
    fetch(uCurl, c + ivec3(1, 0, 0)).w - fetch(uCurl, c - ivec3(1, 0, 0)).w,
    fetch(uCurl, c + ivec3(0, 1, 0)).w - fetch(uCurl, c - ivec3(0, 1, 0)).w,
    fetch(uCurl, c + ivec3(0, 0, 1)).w - fetch(uCurl, c - ivec3(0, 0, 1)).w);
  float gradLen = length(grad);
  if (gradLen > 1e-5) v += uVorticity * cross(grad / gradLen, w) * uDt;
  outVel = vec4(v, 0.0);
}
