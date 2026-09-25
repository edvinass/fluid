uniform vec3 uObsVel; // cells/s
uniform float uCellSize;

out vec4 outObstacle;

// Samples the object into the grid: xyz = velocity of the solid (cells/s), w = signed distance
// in cells. Cells with w < 0 are solid.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c)) {
    outObstacle = vec4(0.0, 0.0, 0.0, 1e4);
    return;
  }
  vec3 world = (vec3(c) + 0.5) * uCellSize - uTunnelHalf;
  outObstacle = vec4(uObsVel, obstacleSdf(world) / uCellSize);
}
