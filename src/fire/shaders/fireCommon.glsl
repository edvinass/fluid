// Boundary conditions and fire emitters shared by the solver passes. The ground (y = 0) is a wall;
// the sides and top are open, so hot air and smoke leave freely and fresh air is drawn in.
uniform sampler2D uSolid; // w = signed distance to scenery in cells
uniform vec3 uBoxHalf;
uniform float uCellSize;
uniform float uTime;

bool isSolid(ivec3 c) {
  return fetch(uSolid, c).w < 0.0;
}

bool isOpen(ivec3 n) {
  return n.x < 0 || n.x >= uRes.x || n.z < 0 || n.z >= uRes.z || n.y >= uRes.y;
}

float pressureAt(sampler2D pressure, ivec3 n, float center) {
  if (isOpen(n)) return 0.0;
  if (n.y < 0 || isSolid(n)) return center;
  return fetch(pressure, n).r;
}

const int MAX_EMITTERS = 8;
uniform int uEmitCount;
uniform vec4 uEmitPos[MAX_EMITTERS]; // xyz cells, w = shape (0 ellipsoid, 1 ring, 2 burst)
uniform vec4 uEmitSize[MAX_EMITTERS]; // radii in cells; ring: x = ring radius, y = tube radius
uniform vec4 uEmitVel[MAX_EMITTERS]; // cells/s (burst: x = outward, y = upward), w = how strongly it's imposed
uniform vec4 uEmitRate[MAX_EMITTERS]; // fuel, heat and smoke added per second; w = flicker

float emitWeight(int i, vec3 p) {
  vec3 d = p - uEmitPos[i].xyz;
  if (uEmitPos[i].w == 1.0) {
    // A ring of separate gas jets.
    vec2 q = vec2(length(d.xz) - uEmitSize[i].x, d.y);
    float jets = pow(0.5 + 0.5 * cos(atan(d.z, d.x) * 20.0), 3.0);
    return exp(-dot(q, q) / (uEmitSize[i].y * uEmitSize[i].y)) * jets;
  }
  vec3 q = d / uEmitSize[i].xyz;
  return exp(-dot(q, q));
}

vec3 emitVelocity(int i, vec3 p) {
  if (uEmitPos[i].w == 2.0) {
    vec3 d = p - uEmitPos[i].xyz;
    return normalize(d + vec3(0.0, 1e-3, 0.0)) * uEmitVel[i].x + vec3(0.0, uEmitVel[i].y, 0.0);
  }
  return uEmitVel[i].xyz;
}
