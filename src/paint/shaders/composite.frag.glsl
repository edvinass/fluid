uniform sampler2D uScene;
uniform sampler2D uVolume;
uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec3 uWaterAbsorb;

in vec2 vUv;
out vec4 outColor;

vec3 faceNormal(vec3 p) {
  vec3 q = abs(p) / uBoxHalf;
  if (q.x > q.y && q.x > q.z) return vec3(sign(p.x), 0.0, 0.0);
  if (q.y > q.z) return vec3(0.0, sign(p.y), 0.0);
  return vec3(0.0, 0.0, sign(p.z));
}

// Puts the paint volume and the water-filled glass tank over the backdrop.
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(mat3(uCameraWorld) * vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0));
  vec3 ro = uCameraWorld[3].xyz;

  float t0, t1;
  if (!boxHit(ro, rd, t0, t1)) {
    outColor = texture(uScene, vUv);
    return;
  }
  t0 = max(t0, 0.0);
  vec3 entry = ro + rd * t0;
  vec3 n = faceNormal(entry);

  // A hint of refraction through the glass and water.
  vec3 nView = transpose(mat3(uCameraWorld)) * n;
  vec2 refr = clamp(vUv - nView.xy * 0.012, vec2(0.0), vec2(1.0));
  vec3 behind = texture(uScene, refr).rgb;

  vec4 vol = texture(uVolume, vUv);
  vec3 water = exp(-uWaterAbsorb * (t1 - t0));
  vec3 color = vol.rgb + vol.a * water * behind;

  float cosTheta = clamp(dot(-rd, n), 0.0, 1.0);
  float fresnel = 0.03 + 0.97 * pow(1.0 - cosTheta, 5.0);
  vec3 reflection = studio(entry, reflect(rd, n), false);
  color = mix(color, reflection, fresnel * (n.y > 0.5 ? 0.9 : 0.5));

  // Bright rim where the line of sight grazes the glass edges.
  vec3 q = abs(entry) / uBoxHalf;
  float edge = max(max(min(q.x, q.y), min(q.y, q.z)), min(q.x, q.z));
  color += vec3(1.0) * smoothstep(0.985, 1.0, edge) * 0.15;

  outColor = vec4(color, 1.0);
}
