uniform sampler2D uPressure;
uniform sampler2D uVel;

out vec4 outVel;

// Subtracts the pressure gradient, then applies the inflow, the slip walls and the object.
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
  float p = fetch(uPressure, c).r;
  vec3 grad = 0.5 * vec3(
    pressureAt(uPressure, c + ivec3(1, 0, 0), p) - pressureAt(uPressure, c - ivec3(1, 0, 0), p),
    pressureAt(uPressure, c + ivec3(0, 1, 0), p) - pressureAt(uPressure, c - ivec3(0, 1, 0), p),
    pressureAt(uPressure, c + ivec3(0, 0, 1), p) - pressureAt(uPressure, c - ivec3(0, 0, 1), p));
  vec3 v = fetch(uVel, c).xyz - grad;

  if (c.y == 0 || c.y == uRes.y - 1) v.y = 0.0;
  if (c.z == 0 || c.z == uRes.z - 1) v.z = 0.0;
  if (c.x == uRes.x - 1) v.x = max(v.x, 0.0);
  outVel = vec4(v, 0.0);
}
