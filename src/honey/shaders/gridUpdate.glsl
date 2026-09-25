uniform sampler2D uGrid; // xyz = momentum, w = mass
uniform float uDt;
uniform float uGravity; // cells / s^2

out vec4 outVel;

// Momentum to velocity, gravity, and collisions. Honey sticks, so nodes inside a solid take on the
// solid's velocity. Solid nodes are marked with w = -1 for the viscosity solve.
void main() {
  ivec3 n = nodeFromFrag(gl_FragCoord.xy);
  vec4 g = texelFetch(uGrid, ivec2(gl_FragCoord.xy), 0);
  vec3 wp = toWorld(vec3(n));
  if (sceneSDF(wp) < 0.0) {
    outVel = vec4(solidVelocity(wp) / uDx, -1.0);
    return;
  }
  vec3 v = vec3(0.0);
  if (g.w > 1e-6) {
    v = g.xyz / g.w;
    v.y -= uGravity * uDt;
  }
  // Slippery walls around the edge of the domain.
  if ((n.x < 2 && v.x < 0.0) || (n.x > uRes.x - 3 && v.x > 0.0)) v.x = 0.0;
  if ((n.y < 2 && v.y < 0.0) || (n.y > uRes.y - 3 && v.y > 0.0)) v.y = 0.0;
  if ((n.z < 2 && v.z < 0.0) || (n.z > uRes.z - 3 && v.z > 0.0)) v.z = 0.0;
  outVel = vec4(v, g.w);
}
