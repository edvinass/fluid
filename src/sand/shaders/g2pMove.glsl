uniform sampler2D uPos;
uniform sampler2D uVel;
uniform sampler2D uC1;
uniform sampler2D uC2;
uniform sampler2D uGridVel;
uniform int uTexW;
uniform int uCount;
uniform float uDt;

layout(location = 0) out vec4 outPos;
layout(location = 1) out vec4 outVel;
layout(location = 2) out vec4 outC1;
layout(location = 3) out vec4 outC2;

// Grid to particle (APIC): gather the new velocity and its gradient C, then move the particle and
// keep it out of the scenery.
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  vec4 pm = texelFetch(uPos, t, 0);
  if (t.y * uTexW + t.x >= uCount) {
    outPos = pm;
    outVel = texelFetch(uVel, t, 0);
    outC1 = texelFetch(uC1, t, 0);
    outC2 = texelFetch(uC2, t, 0);
    return;
  }

  vec3 xg = toGrid(pm.xyz);
  vec3 base = floor(xg - 0.5);
  vec3 fx = xg - base;
  vec3 w[3];
  splineWeights(fx, w);
  vec3 v = vec3(0.0);
  mat3 B = mat3(0.0);
  for (int k = 0; k < 3; k++) {
    for (int j = 0; j < 3; j++) {
      for (int i = 0; i < 3; i++) {
        ivec3 node = ivec3(base) + ivec3(i, j, k);
        vec3 gv = inGrid(node) ? texelFetch(uGridVel, texelOf(node), 0).xyz : vec3(0.0);
        float weight = w[i].x * w[j].y * w[k].z;
        v += weight * gv;
        B += weight * outerProduct(gv, vec3(i, j, k) - fx);
      }
    }
  }
  mat3 C = 4.0 * B;

  float speed = length(v) * uDt;
  if (speed > 0.8) v *= 0.8 / speed;
  vec3 wp = toWorld(xg + uDt * v);
  float margin = 0.2 * uDx;
  float d = sceneSDF(wp);
  if (d < margin) {
    vec3 nrm = sceneNormal(wp);
    wp += nrm * (margin - d);
    vec3 vs = solidVelocity(wp) / uDx;
    float vn = dot(v - vs, nrm);
    if (vn < 0.0) v -= vn * nrm;
  }
  wp = clamp(wp, toWorld(vec3(2.0)), toWorld(vec3(uRes) - 3.0));

  outPos = vec4(wp, pm.w);
  outVel = vec4(v, C[0][0]);
  outC1 = vec4(C[1][0], C[2][0], C[0][1], C[1][1]);
  outC2 = vec4(C[2][1], C[0][2], C[1][2], C[2][2]);
}
