uniform sampler2D uVel;
uniform sampler2D uSrc;
uniform float uDt;
uniform float uDissipation;

out vec4 outValue;

// Semi-Lagrangian advection with a second-order (midpoint) backtrace.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c)) {
    outValue = vec4(0.0);
    return;
  }
  vec3 p = vec3(c) + 0.5;
  vec3 v = fetch(uVel, c).xyz;
  vec3 mid = p - 0.5 * uDt * v;
  vec3 back = p - uDt * sample3D(uVel, mid).xyz;
  outValue = sample3D(uSrc, back) * uDissipation;
}
