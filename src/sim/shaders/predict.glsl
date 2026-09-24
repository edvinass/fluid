uniform sampler2D uPos;
uniform sampler2D uVel;

out vec4 outData;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec3 p = texelFetch(uPos, c, 0).xyz;
  vec3 v = texelFetch(uVel, c, 0).xyz;
  outData = vec4(p + v * uDt, 1.0);
}
