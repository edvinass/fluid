uniform sampler2D uScene;
uniform sampler2D uVolume;
uniform sampler2D uPressure;
uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform vec3 uObjectColor;
uniform int uPressureColour;
uniform float uCpScale; // converts solver pressure to a pressure coefficient
uniform float uCellSize;

in vec2 vUv;
out vec4 outColor;

vec3 faceNormal(vec3 p) {
  vec3 q = abs(p) / uBoxHalf;
  if (q.x > q.y && q.x > q.z) return vec3(sign(p.x), 0.0, 0.0);
  if (q.y > q.z) return vec3(0.0, sign(p.y), 0.0);
  return vec3(0.0, 0.0, sign(p.z));
}

float pressureAt(vec3 cell) {
  vec3 p = clamp(cell - 0.5, vec3(0.0), vec3(uRes) - 1.001);
  ivec3 b = ivec3(floor(p));
  vec3 f = p - vec3(b);
  float v = 0.0;
  for (int k = 0; k < 8; k++) {
    ivec3 o = ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    vec3 w = mix(1.0 - f, f, vec3(o));
    v += fetch(uPressure, b + o).r * w.x * w.y * w.z;
  }
  return v;
}

// Blue for suction (negative pressure coefficient), white at free-stream pressure, red where the
// air piles up against the object.
vec3 pressureRamp(float cp) {
  vec3 low = vec3(0.12, 0.35, 0.95);
  vec3 mid = vec3(0.92, 0.93, 0.95);
  vec3 high = vec3(0.95, 0.2, 0.12);
  return cp < 0.0 ? mix(mid, low, clamp(-cp / 1.2, 0.0, 1.0)) : mix(mid, high, clamp(cp, 0.0, 1.0));
}

vec3 shadeObject(vec3 p, vec3 rd) {
  vec3 n = obstacleNormal(p);
  vec3 albedo = uObjectColor;
  if (uPressureColour == 1) albedo = pressureRamp(pressureAt(toCell(p + n * uCellSize * 1.2)) * uCpScale);

  float ao = 0.0;
  for (int i = 1; i <= 4; i++) {
    float h = 0.012 * float(i);
    ao += (h - obstacleSdf(p + n * h)) / h;
  }
  ao = clamp(1.0 - ao * 0.18, 0.0, 1.0);
  ao *= mix(0.55, 1.0, smoothstep(0.0, 0.12, p.y - uFloorY));

  float sun = max(dot(n, uSunDir), 0.0) * obstacleShadow(p + n * 0.004, uSunDir);
  vec3 sky = mix(uFloorColor * 0.6, uSkyTop, n.y * 0.5 + 0.5);
  vec3 color = albedo * (sky * 0.55 * ao + uAmbient * 0.35 * ao + uSunColor * sun);
  vec3 r = reflect(rd, n);
  float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 5.0);
  color += studio(p, r, false) * fresnel * 0.5 * ao;
  color += uSunColor * pow(max(dot(r, uSunDir), 0.0), 80.0) * 0.6 * sun;
  return color;
}

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

  vec3 behind = texture(uScene, vUv).rgb;
  float tHit;
  if (traceObstacle(ro, rd, t0, t1, tHit)) behind = shadeObject(ro + rd * tHit, rd);

  vec4 vol = texture(uVolume, vUv);
  vec3 color = vol.rgb + vol.a * behind;

  // Faint reflections off the tunnel's glass walls.
  float cosTheta = clamp(dot(-rd, n), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - cosTheta, 5.0);
  color = mix(color, studio(entry, reflect(rd, n), false), fresnel * 0.35);
  vec3 q = abs(entry) / uBoxHalf;
  float edge = max(max(min(q.x, q.y), min(q.y, q.z)), min(q.x, q.z));
  color += vec3(1.0) * smoothstep(0.985, 1.0, edge) * 0.1;

  outColor = vec4(color, 1.0);
}
