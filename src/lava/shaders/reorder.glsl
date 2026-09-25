uniform sampler2D uSorted;
uniform sampler2D uPos;
uniform sampler2D uVel; // w = temperature
uniform int uOutput; // 0 = position, 1 = velocity and temperature

out vec4 outData;

// Gathers particle data into sorted order so neighbours are contiguous in memory.
void main() {
  int i = indexOf(gl_FragCoord.xy);
  int src = int(texelFetch(uSorted, coordOf(i), 0).y);
  ivec2 c = coordOf(src);
  vec3 p = texelFetch(uPos, c, 0).xyz;
  if (uOutput == 0) {
    outData = vec4(p, 1.0);
  } else {
    vec4 v = texelFetch(uVel, c, 0);
    outData = vec4(applyExternal(p, v.xyz), v.w);
  }
}
