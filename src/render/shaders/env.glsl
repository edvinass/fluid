// Procedural studio environment: gradient sky with a sun, and a grid floor with a soft
// contact shadow under the container. Shared by the background pass and fluid reflections.
uniform vec3 uSunDir;
uniform float uFloorY;
uniform vec3 uBoxHalfEnv;
uniform mat3 uBoxInvRot;

vec3 sky(vec3 rd) {
  float up = clamp(rd.y, -1.0, 1.0);
  vec3 horizon = vec3(0.34, 0.42, 0.52);
  vec3 zenith = vec3(0.05, 0.09, 0.16);
  vec3 col = mix(horizon, zenith, pow(max(up, 0.0), 0.55));
  col = mix(col, vec3(0.12, 0.14, 0.17), smoothstep(0.0, -0.25, up));
  float sun = max(dot(rd, uSunDir), 0.0);
  col += vec3(1.0, 0.92, 0.8) * (pow(sun, 900.0) * 6.0 + pow(sun, 24.0) * 0.25);
  return col;
}

float gridLine(vec2 p, float scale, float width) {
  vec2 g = abs(fract(p * scale - 0.5) - 0.5) / fwidth(p * scale);
  return 1.0 - clamp(min(g.x, g.y) / width, 0.0, 1.0);
}

float boxShadow(vec3 hit) {
  // Project the floor point into the container frame and measure distance to its footprint.
  vec3 local = uBoxInvRot * vec3(hit.x, 0.0, hit.z);
  vec2 q = abs(local.xz) - uBoxHalfEnv.xz;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  return 1.0 - 0.55 * (1.0 - smoothstep(-0.25, 0.6, d));
}

vec3 environment(vec3 ro, vec3 rd) {
  if (rd.y < -1e-4) {
    float t = (uFloorY - ro.y) / rd.y;
    if (t > 0.0) {
      vec3 hit = ro + rd * t;
      vec3 base = vec3(0.10, 0.115, 0.135);
      float lines = gridLine(hit.xz, 2.0, 1.0) * 0.5 + gridLine(hit.xz, 0.4, 1.2) * 0.5;
      vec3 floorCol = base + vec3(0.07, 0.09, 0.11) * lines;
      floorCol *= boxShadow(hit);
      float fade = exp(-t * 0.06);
      return mix(sky(rd), floorCol, fade);
    }
  }
  return sky(rd);
}
