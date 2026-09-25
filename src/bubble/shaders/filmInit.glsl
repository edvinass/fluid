uniform float uThickness;
uniform float uSeed;

out vec4 outFilm;

// A freshly blown bubble: fairly even film with soft, random variations.
void main() {
  vec3 p = texelDir(vec2(0.0));
  vec3 s = vec3(uSeed * 17.0, uSeed * 31.0, uSeed * 7.0);
  float n = noise3(p * 3.0 + s) * 0.6 + noise3(p * 7.0 + s) * 0.3 + noise3(p * 15.0 + s) * 0.1;
  outFilm = vec4(uThickness * (0.7 + 0.6 * n), 0.0, 0.0, 1.0);
}
