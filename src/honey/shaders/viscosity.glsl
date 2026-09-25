uniform sampler2D uStar; // velocity after the grid update (fixed right-hand side)
uniform sampler2D uIter; // current estimate
uniform float uAlpha; // kinematic viscosity * dt / dx^2

out vec4 outVel;

// One Jacobi iteration of implicit viscosity, (1 - alpha * laplacian) v = v*, which stays stable
// however thick the honey is. Solid neighbours hold their velocity (no slip); empty neighbours
// are left out, so air exerts no drag on the surface.
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uStar, t, 0);
  if (s.w <= 1e-6) {
    outVel = s;
    return;
  }
  ivec3 n = nodeFromFrag(gl_FragCoord.xy);
  const ivec3 DIRS[6] = ivec3[6](ivec3(1, 0, 0), ivec3(-1, 0, 0), ivec3(0, 1, 0), ivec3(0, -1, 0), ivec3(0, 0, 1), ivec3(0, 0, -1));
  vec3 sum = vec3(0.0);
  float count = 0.0;
  for (int i = 0; i < 6; i++) {
    ivec3 m = n + DIRS[i];
    if (!inGrid(m)) continue;
    vec4 q = texelFetch(uIter, texelOf(m), 0);
    if (q.w < 0.0 || q.w > 1e-6) {
      sum += q.xyz;
      count += 1.0;
    }
  }
  outVel = vec4((s.xyz + uAlpha * sum) / (1.0 + uAlpha * count), s.w);
}
