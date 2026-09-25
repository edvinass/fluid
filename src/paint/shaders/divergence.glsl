uniform sampler2D uVel;

out vec4 outDiv;

// Velocity divergence. Walls are solid, so the normal velocity just outside the grid is zero.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c)) {
    outDiv = vec4(0.0);
    return;
  }
  float l = c.x > 0 ? fetch(uVel, c - ivec3(1, 0, 0)).x : 0.0;
  float r = c.x < uRes.x - 1 ? fetch(uVel, c + ivec3(1, 0, 0)).x : 0.0;
  float b = c.y > 0 ? fetch(uVel, c - ivec3(0, 1, 0)).y : 0.0;
  float t = c.y < uRes.y - 1 ? fetch(uVel, c + ivec3(0, 1, 0)).y : 0.0;
  float d = c.z > 0 ? fetch(uVel, c - ivec3(0, 0, 1)).z : 0.0;
  float u = c.z < uRes.z - 1 ? fetch(uVel, c + ivec3(0, 0, 1)).z : 0.0;
  outDiv = vec4(0.5 * ((r - l) + (t - b) + (u - d)), 0.0, 0.0, 1.0);
}
