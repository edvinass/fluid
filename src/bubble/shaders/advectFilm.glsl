uniform samplerCube uVel;
uniform samplerCube uSrc;
uniform float uDt;

out vec4 outValue;

void main() {
  vec3 p = texelDir(vec2(0.0));
  vec3 mid = normalize(p - 0.5 * uDt * texture(uVel, p).xyz);
  vec3 back = normalize(p - uDt * texture(uVel, mid).xyz);
  outValue = texture(uSrc, back);
}
