uniform sampler2D uGrid; // xyz = momentum, w = mass
uniform float uDt;
uniform float uGravity; // cells / s^2
uniform float uFriction;

out vec4 outVel;

// Momentum to velocity, gravity, and Coulomb friction against the scenery: grains can't move into
// a surface, and sliding along it is slowed in proportion to how hard they press.
void main() {
  ivec3 n = nodeFromFrag(gl_FragCoord.xy);
  vec4 g = texelFetch(uGrid, ivec2(gl_FragCoord.xy), 0);
  if (g.w <= 1e-6) {
    outVel = vec4(0.0);
    return;
  }
  vec3 v = g.xyz / g.w;
  v.y -= uGravity * uDt;

  vec3 wp = toWorld(vec3(n));
  float d = sceneSDF(wp);
  if (d < uDx) {
    vec3 vs = solidVelocity(wp) / uDx;
    if (d < -uDx) {
      v = vs;
    } else {
      vec3 nrm = sceneNormal(wp);
      vec3 rel = v - vs;
      float vn = dot(rel, nrm);
      if (vn < 0.0) {
        vec3 vt = rel - vn * nrm;
        float lt = length(vt);
        rel = lt > 1e-6 ? vt * max(0.0, 1.0 + uFriction * vn / lt) : vec3(0.0);
      }
      v = vs + rel;
    }
  }
  if ((n.x < 2 && v.x < 0.0) || (n.x > uRes.x - 3 && v.x > 0.0)) v.x = 0.0;
  if ((n.y < 2 && v.y < 0.0) || (n.y > uRes.y - 3 && v.y > 0.0)) v.y = 0.0;
  if ((n.z < 2 && v.z < 0.0) || (n.z > uRes.z - 3 && v.z > 0.0)) v.z = 0.0;
  outVel = vec4(v, g.w);
}
