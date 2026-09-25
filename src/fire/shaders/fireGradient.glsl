uniform sampler2D uPressure;
uniform sampler2D uVel;
uniform float uDissipation;

out vec4 outVel;

void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c) || isSolid(c)) {
    outVel = vec4(0.0);
    return;
  }
  float p = fetch(uPressure, c).r;
  vec3 grad = 0.5 * vec3(
    pressureAt(uPressure, c + ivec3(1, 0, 0), p) - pressureAt(uPressure, c - ivec3(1, 0, 0), p),
    pressureAt(uPressure, c + ivec3(0, 1, 0), p) - pressureAt(uPressure, c - ivec3(0, 1, 0), p),
    pressureAt(uPressure, c + ivec3(0, 0, 1), p) - pressureAt(uPressure, c - ivec3(0, 0, 1), p));
  vec3 v = (fetch(uVel, c).xyz - grad) * uDissipation;
  if (c.y == 0) v.y = max(v.y, 0.0);
  outVel = vec4(v, 0.0);
}
