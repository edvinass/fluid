uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uStep; // world units
uniform float uFrame;
uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform float uShadow;
uniform sampler2D uVel;
uniform int uSpeedColour;
uniform float uWind; // cells/s

in vec2 vUv;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Slow air is blue, the free stream green-yellow, and air sped up around the object red.
vec3 speedRamp(float s) {
  float x = clamp(s / 1.6, 0.0, 1.0);
  vec3 c0 = vec3(0.1, 0.25, 0.95);
  vec3 c1 = vec3(0.05, 0.75, 0.95);
  vec3 c2 = vec3(0.35, 0.95, 0.3);
  vec3 c3 = vec3(1.0, 0.85, 0.15);
  vec3 c4 = vec3(1.0, 0.2, 0.1);
  if (x < 0.25) return mix(c0, c1, x * 4.0);
  if (x < 0.5) return mix(c1, c2, x * 4.0 - 1.0);
  if (x < 0.75) return mix(c2, c3, x * 4.0 - 2.0);
  return mix(c3, c4, x * 4.0 - 3.0);
}

// Emission-absorption raymarch through the smoke, stopping at the object. Output: rgb = light
// scattered towards the camera, a = remaining transmittance.
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
  float tHit;
  if (traceObstacle(ro, rd, t0, t1, tHit)) t1 = tHit;

  float t = t0 + uStep * fract(hash(gl_FragCoord.xy) + uFrame * 0.618034);
  float lightStep = uStep * 3.0;
  vec3 color = vec3(0.0);
  float transmittance = 1.0;

  for (int i = 0; i < 768; i++) {
    if (t > t1) break;
    vec3 pos = ro + rd * t;
    vec3 cell = toCell(pos);
    vec4 d = sample3D(uDye, cell);
    if (d.a > 2e-3) {
      vec3 pigment = uSpeedColour == 1 ? speedRamp(length(sample3D(uVel, cell).xyz) / uWind) : d.rgb / d.a;
      float alpha = 1.0 - exp(-d.a * uPaintDensity * uStep);

      float occlusion = 0.0;
      for (int k = 1; k <= 4; k++) {
        vec3 lp = pos + uSunDir * (float(k) * lightStep);
        if (any(greaterThan(abs(lp), uBoxHalf))) break;
        occlusion += sample3D(uDye, toCell(lp)).a;
      }
      float lit = exp(-occlusion * uPaintDensity * lightStep * uShadow);
      color += transmittance * alpha * pigment * (uAmbient + uSunColor * lit);
      transmittance *= 1.0 - alpha;
      if (transmittance < 0.01) break;
    }
    t += uStep;
  }
  outColor = vec4(color, transmittance);
}
