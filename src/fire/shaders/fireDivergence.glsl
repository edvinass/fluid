uniform sampler2D uVel;

out vec4 outDiv;

const ivec3 OFFSETS[6] = ivec3[6](ivec3(-1, 0, 0), ivec3(1, 0, 0), ivec3(0, -1, 0), ivec3(0, 1, 0), ivec3(0, 0, -1), ivec3(0, 0, 1));

vec3 velocityAt(ivec3 n, vec3 self) {
  if (isOpen(n)) return self;
  if (n.y < 0 || isSolid(n)) return vec3(0.0);
  return fetch(uVel, n).xyz;
}

// r = velocity divergence; g = how each neighbour's pressure is treated by the Jacobi passes, two
// bits per neighbour: 0 = fluid, 1 = open air (pressure 0), 2 = wall or scenery (no gradient).
// Solid cells get g = -1.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c) || isSolid(c)) {
    outDiv = vec4(0.0, -1.0, 0.0, 1.0);
    return;
  }
  vec3 v = fetch(uVel, c).xyz;
  float l = velocityAt(c - ivec3(1, 0, 0), v).x;
  float r = velocityAt(c + ivec3(1, 0, 0), v).x;
  float b = velocityAt(c - ivec3(0, 1, 0), v).y;
  float t = velocityAt(c + ivec3(0, 1, 0), v).y;
  float d = velocityAt(c - ivec3(0, 0, 1), v).z;
  float u = velocityAt(c + ivec3(0, 0, 1), v).z;

  int mask = 0;
  for (int k = 0; k < 6; k++) {
    ivec3 n = c + OFFSETS[k];
    int code = isOpen(n) ? 1 : (n.y < 0 || isSolid(n)) ? 2 : 0;
    mask |= code << (2 * k);
  }
  outDiv = vec4(0.5 * ((r - l) + (t - b) + (u - d)), float(mask), 0.0, 1.0);
}
