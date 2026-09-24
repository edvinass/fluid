uniform sampler2D uSorted;
uniform int uCount;
uniform int uNumCells;

out vec4 outRange;

int lowerBound(float key, int lo) {
  int hi = uCount;
  for (int s = 0; s < 32; s++) {
    if (lo >= hi) break;
    int mid = (lo + hi) >> 1;
    if (texelFetch(uSorted, coordOf(mid), 0).x < key) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

// For each grid cell, stores the [start, end) range of its particles in the sorted list.
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int cell = (p.y << TEX_SHIFT) + p.x;
  if (cell >= uNumCells) {
    outRange = vec4(0.0);
    return;
  }
  int start = lowerBound(float(cell), 0);
  int end = lowerBound(float(cell) + 1.0, start);
  outRange = vec4(float(start), float(end), 0.0, 0.0);
}
