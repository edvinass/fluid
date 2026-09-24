uniform sampler2D uCellStart;
uniform float uH;
uniform float uMass;
uniform float uSpiky2Norm; // 15 / (2 pi h^5)
uniform float uSpiky3Norm; // 15 / (pi h^6)
uniform float uPoly6Norm; // 315 / (64 pi h^9)

const int MAX_PER_ROW = 128;

// Cells along x are contiguous in the sorted list, so a row of three neighbouring cells
// (x-1..x+1) is a single [start, end) range. Returns an empty range for rows outside the grid.
ivec2 rowRange(ivec3 cell, int dy, int dz) {
  int y = cell.y + dy;
  int z = cell.z + dz;
  if (y < 0 || y >= uGridRes.y || z < 0 || z >= uGridRes.z) return ivec2(0);
  int start = int(texelFetch(uCellStart, cellCoord(keyOf(ivec3(max(cell.x - 1, 0), y, z))), 0).x);
  int end = int(texelFetch(uCellStart, cellCoord(keyOf(ivec3(min(cell.x + 1, uGridRes.x - 1), y, z))), 0).y);
  return ivec2(start, min(end, start + MAX_PER_ROW));
}
