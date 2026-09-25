out vec4 outSolid;

void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c)) {
    outSolid = vec4(0.0, 0.0, 0.0, 1e4);
    return;
  }
  vec3 world = (vec3(c) + 0.5) * uCellSize - uBoxHalf;
  outSolid = vec4(0.0, 0.0, 0.0, sceneSdf(world) / uCellSize);
}
