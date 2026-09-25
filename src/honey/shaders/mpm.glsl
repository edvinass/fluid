#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

// The MPM background grid: uRes nodes stored as a 2D atlas of z-slices (uCols tiles per row).
// Node (i, j, k) sits at world position uOrigin + (i, j, k) * uDx. The solver works in grid units
// (one cell = 1), and particle positions are stored in world units.
uniform ivec3 uRes;
uniform int uCols;
uniform float uDx;
uniform vec3 uOrigin;

ivec3 nodeFromFrag(vec2 fragCoord) {
  ivec2 p = ivec2(fragCoord);
  int tx = p.x / uRes.x;
  int ty = p.y / uRes.y;
  return ivec3(p.x - tx * uRes.x, p.y - ty * uRes.y, ty * uCols + tx);
}

bool inGrid(ivec3 c) {
  return all(greaterThanEqual(c, ivec3(0))) && all(lessThan(c, uRes));
}

ivec2 texelOf(ivec3 c) {
  return ivec2((c.z % uCols) * uRes.x + c.x, (c.z / uCols) * uRes.y + c.y);
}

vec3 toWorld(vec3 g) {
  return uOrigin + g * uDx;
}

vec3 toGrid(vec3 w) {
  return (w - uOrigin) / uDx;
}

// Quadratic B-spline weights for the 3 nodes around a particle, per axis.
void splineWeights(vec3 fx, out vec3 w[3]) {
  w[0] = 0.5 * (1.5 - fx) * (1.5 - fx);
  w[1] = 0.75 - (fx - 1.0) * (fx - 1.0);
  w[2] = 0.5 * (fx - 0.5) * (fx - 0.5);
}
