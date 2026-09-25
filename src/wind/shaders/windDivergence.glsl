uniform sampler2D uVel;

out vec4 outDiv;

vec3 velocityAt(ivec3 n, vec3 self) {
  if (n.x < 0) return inflow(n);
  if (n.x >= uRes.x) return self;
  if (!inGrid(n)) return vec3(0.0);
  vec4 obstacle = fetch(uObstacle, n);
  return obstacle.w < 0.0 ? obstacle.xyz : fetch(uVel, n).xyz;
}

void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c) || isSolid(c)) {
    outDiv = vec4(0.0);
    return;
  }
  vec3 v = fetch(uVel, c).xyz;
  float l = velocityAt(c - ivec3(1, 0, 0), v).x;
  float r = velocityAt(c + ivec3(1, 0, 0), v).x;
  float b = velocityAt(c - ivec3(0, 1, 0), v).y;
  float t = velocityAt(c + ivec3(0, 1, 0), v).y;
  float d = velocityAt(c - ivec3(0, 0, 1), v).z;
  float u = velocityAt(c + ivec3(0, 0, 1), v).z;
  outDiv = vec4(0.5 * ((r - l) + (t - b) + (u - d)), 0.0, 0.0, 1.0);
}
