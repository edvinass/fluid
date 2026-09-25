uniform samplerCube uPressure;
uniform samplerCube uDiv;

out vec4 outPressure;

// One Jacobi iteration of the Poisson equation on the sphere, with the neighbours weighted by
// their (uneven) angular spacing.
void main() {
  vec3 p = texelDir(vec2(0.0));
  Neighbours nb = neighbours(p);
  float sum = 0.0;
  float weights = 0.0;
  for (int k = 0; k < 4; k++) {
    float w = 2.0 / (nb.a[k] * (nb.a[k] + nb.a[k ^ 1]));
    sum += w * texture(uPressure, nb.q[k]).r;
    weights += w;
  }
  outPressure = vec4((sum - texture(uDiv, p).r) / weights, 0.0, 0.0, 1.0);
}
