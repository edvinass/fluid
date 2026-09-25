uniform samplerCube uPressure;
uniform samplerCube uVel;

out vec4 outVel;

void main() {
  vec3 p = texelDir(vec2(0.0));
  Neighbours nb = neighbours(p);
  vec4 pn = vec4(texture(uPressure, nb.q[0]).r, texture(uPressure, nb.q[1]).r, texture(uPressure, nb.q[2]).r, texture(uPressure, nb.q[3]).r);
  vec3 v = texture(uVel, p).xyz - gradient(nb, pn);
  outVel = vec4(toTangent(v, p), 0.0);
}
