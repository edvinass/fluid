// Scenery shared by the solver (as colliders) and the renderer, in world units.
uniform int uScene; // 0 = plate, 1 = bowl
uniform int uDipperOn;
uniform vec3 uDipperPos; // bottom centre of the dipper's head
uniform vec3 uDipperVel; // world units per second
uniform float uDipperSpin; // radians per second about the vertical axis
uniform float uDipperAngle;

const float TABLE_Y = -0.62;
const float PLATE_R = 0.6;
const vec3 BOWL_C = vec3(0.0, TABLE_Y + 0.47, 0.0);
const float BOWL_R = 0.44;
const float BOWL_T = 0.025;
const float DIPPER_HEAD = 0.22;
const float GROOVE = 0.055;

float plateSDF(vec3 p) {
  float r = length(p.xz);
  float top = TABLE_Y + 0.012 + 0.035 * smoothstep(0.34, 0.58, r);
  // The underside curves in towards a narrower foot.
  float bottom = TABLE_Y + 0.02 * smoothstep(0.3, 0.6, r);
  return max(max((p.y - top) * 0.85, bottom - p.y), r - PLATE_R);
}

float bowlSDF(vec3 p) {
  vec3 q = p - BOWL_C;
  return max(abs(length(q) - BOWL_R) - BOWL_T, q.y);
}

float dipperSDF(vec3 p) {
  if (uDipperOn == 0) return 1e3;
  vec3 q = p - uDipperPos;
  float groove = 0.5 + 0.5 * cos(q.y * 6.2831853 / GROOVE);
  float head = max(length(q.xz) - (0.055 + 0.025 * groove), abs(q.y - DIPPER_HEAD * 0.5) - DIPPER_HEAD * 0.5);
  float shaft = max(length(q.xz) - 0.022, abs(q.y - 0.75) - 0.6);
  return min(head * 0.8, shaft);
}

float dishSDF(vec3 p) {
  return uScene == 0 ? plateSDF(p) : bowlSDF(p);
}

float sceneSDF(vec3 p) {
  return min(min(p.y - TABLE_Y, dishSDF(p)), dipperSDF(p));
}

vec3 sceneNormal(vec3 p) {
  const vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(
    sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
    sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
    sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)));
}

// Velocity of the solid at p (world units per second); only the dipper moves.
vec3 solidVelocity(vec3 p) {
  if (dipperSDF(p) < 0.0) return uDipperVel + cross(vec3(0.0, uDipperSpin, 0.0), p - uDipperPos);
  return vec3(0.0);
}
