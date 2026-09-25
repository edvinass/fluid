uniform sampler2D uPressure;
uniform sampler2D uVel;
uniform float uDissipation;

out vec4 outVel;

float neighbor(ivec3 c, float center) {
  return inGrid(c) ? fetch(uPressure, c).r : center;
}

// Subtracts the pressure gradient to make the velocity field divergence-free, then stops flow
// through the tank walls.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c)) {
    outVel = vec4(0.0);
    return;
  }
  float p = fetch(uPressure, c).r;
  vec3 grad = 0.5 * vec3(
    neighbor(c + ivec3(1, 0, 0), p) - neighbor(c - ivec3(1, 0, 0), p),
    neighbor(c + ivec3(0, 1, 0), p) - neighbor(c - ivec3(0, 1, 0), p),
    neighbor(c + ivec3(0, 0, 1), p) - neighbor(c - ivec3(0, 0, 1), p));
  vec3 v = (fetch(uVel, c).xyz - grad) * uDissipation;

  if (c.x == 0 || c.x == uRes.x - 1) v.x = 0.0;
  if (c.y == 0 || c.y == uRes.y - 1) v.y = 0.0;
  if (c.z == 0 || c.z == uRes.z - 1) v.z = 0.0;
  outVel = vec4(v, 0.0);
}
