uniform float uStep; // world units
uniform float uFrame;
uniform float uBrightness;
uniform float uSmokeDensity;

in vec2 vUv;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Fades the volume out towards the open sides and top, so the simulation box never shows.
float edgeFade(vec3 p) {
  vec3 d = uBoxHalf - abs(p);
  float top = uBoxHalf.y - p.y;
  return smoothstep(0.0, 0.18, min(min(d.x, d.z), top));
}

// Flames emit light; smoke absorbs it and is lit by the fire. Output: rgb = light towards the
// camera, a = remaining transmittance.
void main() {
  vec3 rd = cameraRay(vUv);
  vec3 ro = uCameraWorld[3].xyz;
  float t0, t1;
  if (!boxHit(ro, rd, t0, t1)) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  t0 = max(t0, 0.0);
  float tHit;
  if (traceScene(ro, rd, t1, tHit)) t1 = min(t1, tHit);

  float t = t0 + uStep * fract(hash(gl_FragCoord.xy) + uFrame * 0.618034);
  vec3 color = vec3(0.0);
  float transmittance = 1.0;
  for (int i = 0; i < 768; i++) {
    if (t > t1) break;
    vec3 pos = ro + rd * t;
    vec4 s = sample3D(uState, toCell(pos));
    float fade = edgeFade(pos);
    float temperature = s.r * fade;
    float smoke = s.g * fade;
    if (temperature + smoke > 2e-3) {
      float sigma = smoke * uSmokeDensity + temperature * 1.5;
      float alpha = 1.0 - exp(-sigma * uStep);
      vec3 l;
      float dist;
      vec3 lit = fireLight(pos, l, dist) * 0.12 + vec3(0.004, 0.005, 0.008);
      vec3 smokeColor = vec3(0.2, 0.19, 0.18) * lit;
      color += transmittance * (flameColor(temperature) * uBrightness * uStep + smokeColor * alpha);
      transmittance *= 1.0 - alpha;
      if (transmittance < 0.01) break;
    }
    t += uStep;
  }
  outColor = vec4(color, transmittance);
}
