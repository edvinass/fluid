uniform sampler2D uPressure;
uniform sampler2D uDiv; // r = divergence, g = neighbour mask (see fireDivergence.glsl)

out vec4 outPressure;

const ivec3 OFFSETS[6] = ivec3[6](ivec3(-1, 0, 0), ivec3(1, 0, 0), ivec3(0, -1, 0), ivec3(0, 1, 0), ivec3(0, 0, -1), ivec3(0, 0, 1));

// One Jacobi iteration of the pressure Poisson equation.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  vec2 dm = inGrid(c) ? fetch(uDiv, c).rg : vec2(0.0, -1.0);
  if (dm.g < 0.0) {
    outPressure = vec4(0.0);
    return;
  }
  int mask = int(dm.g);
  float p = fetch(uPressure, c).r;
  float sum = 0.0;
  for (int k = 0; k < 6; k++) {
    int code = (mask >> (2 * k)) & 3;
    sum += code == 0 ? fetch(uPressure, c + OFFSETS[k]).r : (code == 1 ? 0.0 : p);
  }
  outPressure = vec4((sum - dm.r) / 6.0, 0.0, 0.0, 1.0);
}
