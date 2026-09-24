uniform sampler2D uSorted;
uniform sampler2D uPos;
uniform sampler2D uVel;
uniform int uOutput; // 0 = position, 1 = velocity (with external forces applied)

out vec4 outData;

// Gathers particle data into sorted order so neighbours are contiguous in memory.
void main() {
  int i = indexOf(gl_FragCoord.xy);
  int src = int(texelFetch(uSorted, coordOf(i), 0).y);
  ivec2 c = coordOf(src);
  vec3 p = uFrameRot * texelFetch(uPos, c, 0).xyz;
  if (uOutput == 0) {
    outData = vec4(p, 1.0);
  } else {
    vec3 v = applyExternal(p, uFrameRot * texelFetch(uVel, c, 0).xyz);
    outData = vec4(v, 0.0);
  }
}
