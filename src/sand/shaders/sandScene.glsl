// Scenery shared by the solver (as colliders) and the renderer, in world units: a table, a wooden
// sandbox on it, and a ball that can be thrown or pushed around.
uniform int uBallOn;
uniform vec3 uBallPos;
uniform vec3 uBallVel; // world units per second
uniform float uBallRadius;

const float TABLE_Y = -0.5;
const float TRAY_HALF = 0.72;
const float TRAY_FLOOR = TABLE_Y + 0.025;
const float TRAY_WALL = 0.03;
const float TRAY_HEIGHT = 0.16;

float boxSDF(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float traySDF(vec3 p) {
  float floorBox = boxSDF(p - vec3(0.0, (TABLE_Y + TRAY_FLOOR) * 0.5, 0.0), vec3(TRAY_HALF + TRAY_WALL, (TRAY_FLOOR - TABLE_Y) * 0.5, TRAY_HALF + TRAY_WALL));
  float wallY = TABLE_Y + TRAY_HEIGHT * 0.5;
  vec3 q = vec3(abs(p.x), p.y - wallY, abs(p.z));
  float wallX = boxSDF(q - vec3(TRAY_HALF + TRAY_WALL * 0.5, 0.0, 0.0), vec3(TRAY_WALL * 0.5, TRAY_HEIGHT * 0.5, TRAY_HALF + TRAY_WALL));
  float wallZ = boxSDF(q - vec3(0.0, 0.0, TRAY_HALF + TRAY_WALL * 0.5), vec3(TRAY_HALF + TRAY_WALL, TRAY_HEIGHT * 0.5, TRAY_WALL * 0.5));
  return min(floorBox, min(wallX, wallZ));
}

float ballSDF(vec3 p) {
  return uBallOn == 0 ? 1e3 : length(p - uBallPos) - uBallRadius;
}

float sceneSDF(vec3 p) {
  return min(min(p.y - TABLE_Y, traySDF(p)), ballSDF(p));
}

vec3 sceneNormal(vec3 p) {
  const vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(
    sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
    sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
    sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)));
}

vec3 solidVelocity(vec3 p) {
  return ballSDF(p) < 0.01 ? uBallVel : vec3(0.0);
}
