uniform samplerCube uVel;
uniform float uDt;

out vec4 outVel;

// Semi-Lagrangian advection along the sphere with a midpoint backtrace. The velocity found upstream
// is projected back onto this texel's tangent plane, keeping its speed.
void main() {
  vec3 p = texelDir(vec2(0.0));
  vec3 v = texture(uVel, p).xyz;
  vec3 mid = normalize(p - 0.5 * uDt * v);
  vec3 back = normalize(p - uDt * texture(uVel, mid).xyz);
  vec3 u = texture(uVel, back).xyz;
  vec3 t = toTangent(u, p);
  float len = length(t);
  outVel = vec4(len > 1e-6 ? t * (length(u) / len) : vec3(0.0), 0.0);
}
