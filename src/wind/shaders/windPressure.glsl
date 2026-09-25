uniform sampler2D uPressure;
uniform sampler2D uDiv;

out vec4 outPressure;

// One Jacobi iteration of the pressure Poisson equation. Solid cells take the average of their
// fluid neighbours, so the surface pressure can be read back smoothly for display.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c)) {
    outPressure = vec4(0.0);
    return;
  }
  const ivec3 OFFSETS[6] = ivec3[6](ivec3(1, 0, 0), ivec3(-1, 0, 0), ivec3(0, 1, 0), ivec3(0, -1, 0), ivec3(0, 0, 1), ivec3(0, 0, -1));
  float p = fetch(uPressure, c).r;
  if (isSolid(c)) {
    float sum = 0.0;
    float count = 0.0;
    for (int i = 0; i < 6; i++) {
      ivec3 n = c + OFFSETS[i];
      if (inGrid(n) && !isSolid(n)) {
        sum += fetch(uPressure, n).r;
        count += 1.0;
      }
    }
    outPressure = vec4(count > 0.0 ? sum / count : p, 0.0, 0.0, 1.0);
    return;
  }
  float sum = 0.0;
  for (int i = 0; i < 6; i++) sum += pressureAt(uPressure, c + OFFSETS[i], p);
  outPressure = vec4((sum - fetch(uDiv, c).r) / 6.0, 0.0, 0.0, 1.0);
}
