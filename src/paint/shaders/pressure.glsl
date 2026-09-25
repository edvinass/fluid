uniform sampler2D uPressure;
uniform sampler2D uDiv;

out vec4 outPressure;

float neighbor(ivec3 c, float center) {
  return inGrid(c) ? fetch(uPressure, c).r : center;
}

// One Jacobi iteration of the pressure Poisson equation, with zero-gradient (solid wall) boundaries.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c)) {
    outPressure = vec4(0.0);
    return;
  }
  float p = fetch(uPressure, c).r;
  float sum = neighbor(c - ivec3(1, 0, 0), p) + neighbor(c + ivec3(1, 0, 0), p)
    + neighbor(c - ivec3(0, 1, 0), p) + neighbor(c + ivec3(0, 1, 0), p)
    + neighbor(c - ivec3(0, 0, 1), p) + neighbor(c + ivec3(0, 0, 1), p);
  outPressure = vec4((sum - fetch(uDiv, c).r) / 6.0, 0.0, 0.0, 1.0);
}
