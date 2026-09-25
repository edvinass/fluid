// Tunnel boundary conditions shared by the solver passes: air enters at x = 0 with the wind speed
// (plus a little turbulence), leaves freely at the far end, and slips along the side walls.
uniform sampler2D uObstacle;
uniform float uWind; // cells/s
uniform float uTurbulence;
uniform float uTime;

bool isSolid(ivec3 c) {
  return fetch(uObstacle, c).w < 0.0;
}

vec3 inflow(ivec3 c) {
  vec2 q = vec2(c.yz);
  float n1 = sin(q.x * 0.21 + uTime * 2.3) * sin(q.y * 0.17 - uTime * 1.7) + 0.5 * sin(q.y * 0.43 + uTime * 3.1);
  float n2 = sin(q.y * 0.19 + uTime * 2.1) * sin(q.x * 0.23 + uTime * 1.3) + 0.5 * sin(q.x * 0.41 - uTime * 2.9);
  return vec3(1.0, n1 * uTurbulence, n2 * uTurbulence) * uWind;
}

// Pressure of a neighbour, applying the boundary conditions: fixed at zero at the outlet, zero
// gradient through the inlet, the walls and the object.
float pressureAt(sampler2D pressure, ivec3 n, float center) {
  if (n.x >= uRes.x) return 0.0;
  if (!inGrid(n) || isSolid(n)) return center;
  return fetch(pressure, n).r;
}
