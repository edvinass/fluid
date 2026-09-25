uniform sampler2D uPos; // w = material + grain seed
uniform sampler2D uVel; // new velocity gradient, from the move pass
uniform sampler2D uC1;
uniform sampler2D uC2;
uniform sampler2D uF0; // F00 F01 F02 F10
uniform sampler2D uF1; // F11 F12 F20 F21
uniform sampler2D uS1; // (t12 t22) F22 Jp
uniform int uTexW;
uniform int uCount;
uniform float uDt;
uniform float uStiffness; // Young's modulus, grid units

layout(location = 0) out vec4 outF0;
layout(location = 1) out vec4 outF1;
layout(location = 2) out vec4 outS0;
layout(location = 3) out vec4 outS1;

const int SAND = 0;
const int WET_SAND = 1;
const int SNOW = 2;
const int JELLY = 3;

// Eigen decomposition of a symmetric matrix by cyclic Jacobi rotations: A = V diag(d) V^T.
void eigenSymmetric(mat3 A, out mat3 V, out vec3 d) {
  V = mat3(1.0);
  for (int sweep = 0; sweep < 5; sweep++) {
    for (int k = 0; k < 3; k++) {
      int p = k == 2 ? 1 : 0;
      int q = k == 0 ? 1 : 2;
      float apq = A[q][p];
      if (abs(apq) < 1e-12) continue;
      float theta = (A[q][q] - A[p][p]) / (2.0 * apq);
      float tn = (theta >= 0.0 ? 1.0 : -1.0) / (abs(theta) + sqrt(theta * theta + 1.0));
      float c = inversesqrt(tn * tn + 1.0);
      float s = tn * c;
      mat3 J = mat3(1.0);
      J[p][p] = c;
      J[q][q] = c;
      J[q][p] = s;
      J[p][q] = -s;
      A = transpose(J) * A * J;
      V = V * J;
    }
  }
  d = vec3(A[0][0], A[1][1], A[2][2]);
}

// F = U diag(sig) V^T with U and V rotations and the singular values sorted largest first.
void svd3(mat3 F, out mat3 U, out vec3 sig, out mat3 V) {
  vec3 d;
  eigenSymmetric(transpose(F) * F, V, d);
  if (d.x < d.y) { d.xy = d.yx; vec3 t = V[0]; V[0] = V[1]; V[1] = t; }
  if (d.x < d.z) { d.xz = d.zx; vec3 t = V[0]; V[0] = V[2]; V[2] = t; }
  if (d.y < d.z) { d.yz = d.zy; vec3 t = V[1]; V[1] = V[2]; V[2] = t; }
  if (determinant(V) < 0.0) V[2] = -V[2];
  vec3 u0 = F * V[0];
  float l0 = length(u0);
  u0 = l0 > 1e-8 ? u0 / l0 : vec3(1.0, 0.0, 0.0);
  vec3 u1 = F * V[1];
  u1 -= dot(u1, u0) * u0;
  float l1 = length(u1);
  if (l1 > 1e-8) u1 /= l1;
  else u1 = normalize(abs(u0.x) < 0.9 ? cross(u0, vec3(1.0, 0.0, 0.0)) : cross(u0, vec3(0.0, 1.0, 0.0)));
  vec3 u2 = cross(u0, u1);
  U = mat3(u0, u1, u2);
  sig = vec3(l0, dot(F * V[1], u1), dot(F * V[2], u2));
}

// Drucker-Prager plasticity in Hencky strain (Klar et al. 2016): grains can't pull apart (beyond
// the cohesion) and slide once shear exceeds friction times pressure.
vec3 sandProjection(vec3 sig, float mu, float lambda, float alpha, float cohesion) {
  vec3 eps = log(max(sig, vec3(1e-4))) - cohesion;
  float tr = eps.x + eps.y + eps.z;
  vec3 dev = eps - tr / 3.0;
  float devNorm = length(dev);
  if (tr >= 0.0) {
    eps = vec3(0.0);
  } else {
    float dg = devNorm + (3.0 * lambda + 2.0 * mu) / (2.0 * mu) * tr * alpha;
    if (dg > 0.0) eps -= dg * dev / max(devNorm, 1e-8);
  }
  return exp(eps + cohesion);
}

// Deformation update and plasticity, then the Kirchhoff stress for the next particle-to-grid.
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  vec4 f0 = texelFetch(uF0, t, 0);
  vec4 f1 = texelFetch(uF1, t, 0);
  vec4 s1 = texelFetch(uS1, t, 0);
  if (t.y * uTexW + t.x >= uCount) {
    outF0 = f0;
    outF1 = f1;
    outS0 = vec4(0.0);
    outS1 = vec4(0.0, 0.0, s1.z, s1.w);
    return;
  }
  int material = int(texelFetch(uPos, t, 0).w);
  vec4 vc = texelFetch(uVel, t, 0);
  vec4 c1 = texelFetch(uC1, t, 0);
  vec4 c2 = texelFetch(uC2, t, 0);
  mat3 C = mat3(vc.w, c1.z, c2.y, c1.x, c1.w, c2.z, c1.y, c2.x, c2.w);
  mat3 F = mat3(f0.x, f0.w, f1.z, f0.y, f1.x, f1.w, f0.z, f1.y, s1.z);
  float Jp = s1.w;

  F = (mat3(1.0) + uDt * C) * F;
  mat3 U, V;
  vec3 sig;
  svd3(F, U, sig, V);

  float E = uStiffness;
  float nu = material == SNOW ? 0.25 : 0.3;
  if (material == JELLY) E *= 0.12;
  float mu = E / (2.0 * (1.0 + nu));
  float lambda = E * nu / ((1.0 + nu) * (1.0 - 2.0 * nu));
  mat3 stress;

  if (material <= SNOW) {
    // Dry sand pours and slides; wet sand and snow stick together in clumps until pulled apart,
    // with snow the stickiest (a steeper friction angle and more cohesion).
    float alpha = material == SAND ? 0.39 : material == WET_SAND ? 0.45 : 0.5;
    float cohesion = material == SAND ? 0.0 : material == WET_SAND ? 0.004 : 0.01;
    sig = sandProjection(sig, mu, lambda, alpha, cohesion);
    F = U * mat3(sig.x, 0.0, 0.0, 0.0, sig.y, 0.0, 0.0, 0.0, sig.z) * transpose(V);
    vec3 eps = log(sig);
    float tr = eps.x + eps.y + eps.z;
    vec3 tauDiag = 2.0 * mu * eps + lambda * tr;
    stress = U * mat3(tauDiag.x, 0.0, 0.0, 0.0, tauDiag.y, 0.0, 0.0, 0.0, tauDiag.z) * transpose(U);
  } else {
    // Fixed corotated elasticity: wobbly jelly, and stiff coal and carrot.
    float J = sig.x * sig.y * sig.z;
    mat3 R = U * transpose(V);
    stress = 2.0 * mu * (F - R) * transpose(F) + mat3(lambda * J * (J - 1.0));
  }

  outF0 = vec4(F[0][0], F[1][0], F[2][0], F[0][1]);
  outF1 = vec4(F[1][1], F[2][1], F[0][2], F[1][2]);
  outS0 = vec4(stress[0][0], stress[1][0], stress[2][0], stress[1][1]);
  outS1 = vec4(stress[2][1], stress[2][2], F[2][2], Jp);
}
