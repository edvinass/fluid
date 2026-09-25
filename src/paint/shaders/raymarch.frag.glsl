uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uStep; // world units
uniform float uFrame;
uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform float uShadow;

in vec2 vUv;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float densityAt(vec3 world) {
  return sample3D(uDye, toCell(world)).a;
}

// Emission-absorption raymarch through the paint volume. Output: rgb = light scattered towards
// the camera, a = remaining transmittance.
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(mat3(uCameraWorld) * vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0));
  vec3 ro = uCameraWorld[3].xyz;

  float t0, t1;
  if (!boxHit(ro, rd, t0, t1)) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  t0 = max(t0, 0.0);

  // Jitter the start to trade banding for fine noise.
  float t = t0 + uStep * fract(hash(gl_FragCoord.xy) + uFrame * 0.618034);
  float lightStep = uStep * 3.0;
  vec3 color = vec3(0.0);
  float transmittance = 1.0;

  for (int i = 0; i < 512; i++) {
    if (t > t1) break;
    vec3 pos = ro + rd * t;
    vec4 d = sample3D(uDye, toCell(pos));
    if (d.a > 2e-3) {
      vec3 pigment = d.rgb / d.a;
      float alpha = 1.0 - exp(-d.a * uPaintDensity * uStep);

      float occlusion = 0.0;
      for (int k = 1; k <= 5; k++) {
        vec3 lp = pos + uSunDir * (float(k) * lightStep);
        if (any(greaterThan(abs(lp), uBoxHalf))) break;
        occlusion += densityAt(lp);
      }
      float lit = exp(-occlusion * uPaintDensity * lightStep * uShadow);
      vec3 shade = pigment * (uAmbient + uSunColor * lit);

      color += transmittance * alpha * shade;
      transmittance *= 1.0 - alpha;
      if (transmittance < 0.01) break;
    }
    t += uStep;
  }
  outColor = vec4(color, transmittance);
}
