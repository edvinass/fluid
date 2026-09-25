#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

// A 3D grid of uRes cells stored as a 2D atlas: z-slices of size uRes.x * uRes.y laid out in
// rows of uCols tiles. Positions in "cell space" put the centre of cell (i, j, k) at (i, j, k) + 0.5.
uniform ivec3 uRes;
uniform int uCols;

ivec3 cellFromFrag(vec2 fragCoord) {
  ivec2 p = ivec2(fragCoord);
  int tx = p.x / uRes.x;
  int ty = p.y / uRes.y;
  return ivec3(p.x - tx * uRes.x, p.y - ty * uRes.y, ty * uCols + tx);
}

bool inGrid(ivec3 c) {
  return all(greaterThanEqual(c, ivec3(0))) && all(lessThan(c, uRes));
}

ivec2 texelOf(ivec3 c) {
  c = clamp(c, ivec3(0), uRes - 1);
  return ivec2((c.z % uCols) * uRes.x + c.x, (c.z / uCols) * uRes.y + c.y);
}

vec4 fetch(sampler2D t, ivec3 c) {
  return texelFetch(t, texelOf(c), 0);
}

// Trilinear sample: hardware bilinear within a slice, manual blend between slices. The in-slice
// position is clamped to texel centres so filtering never bleeds into a neighbouring tile.
vec4 sample3D(sampler2D t, vec3 p) {
  vec3 res = vec3(uRes);
  p = clamp(p, vec3(0.5), res - 0.5);
  float zf = p.z - 0.5;
  int z0 = int(floor(zf));
  int z1 = min(z0 + 1, uRes.z - 1);
  float fz = zf - float(z0);
  vec2 invAtlas = 1.0 / vec2(textureSize(t, 0));
  vec2 uv0 = (vec2(float(z0 % uCols), float(z0 / uCols)) * res.xy + p.xy) * invAtlas;
  vec2 uv1 = (vec2(float(z1 % uCols), float(z1 / uCols)) * res.xy + p.xy) * invAtlas;
  return mix(texture(t, uv0), texture(t, uv1), fz);
}

// Paint sources (pour streams and stirring), in cell space.
const int MAX_SOURCES = 4;
uniform int uSourceCount;
uniform vec3 uSourcePos[MAX_SOURCES];
uniform vec3 uSourceVel[MAX_SOURCES];
uniform vec4 uSourceColor[MAX_SOURCES]; // rgb pigment, a = paint added per second
uniform vec2 uSourceShape[MAX_SOURCES]; // x = radius (cells), y = vertical stretch

float sourceWeight(int i, vec3 p) {
  vec3 d = p - uSourcePos[i];
  d.y /= uSourceShape[i].y;
  float r = uSourceShape[i].x;
  return exp(-dot(d, d) / (r * r));
}
