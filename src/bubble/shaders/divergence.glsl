uniform samplerCube uVel;

out vec4 outDiv;

// Net outflow towards the four neighbours.
void main() {
  vec3 p = texelDir(vec2(0.0));
  Neighbours nb = neighbours(p);
  float div = 0.0;
  for (int k = 0; k < 4; k++) {
    int opposite = k ^ 1;
    div += dot(texture(uVel, nb.q[k]).xyz, nb.t[k]) / (nb.a[k] + nb.a[opposite]);
  }
  outDiv = vec4(div, 0.0, 0.0, 1.0);
}
