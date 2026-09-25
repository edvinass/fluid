uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec4 uCoat; // rgb = colour of the liquid coating the dipper, a = how much

in vec2 vUv;
out vec4 outColor; // rgb = linear colour, a = view depth (0 for the far background)

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}

vec3 woodTable(vec3 p) {
  vec2 q = p.xz * vec2(1.0, 6.0);
  float grain = noise2(q * 3.0 + noise2(q * 0.7) * 2.0);
  float rings = 0.5 + 0.5 * sin(grain * 18.0 + p.x * 4.0);
  float plank = smoothstep(0.0, 0.006, abs(fract(p.z * 1.4 + 0.5) - 0.5) * 2.0 - 0.004);
  vec3 col = mix(vec3(0.28, 0.14, 0.06), vec3(0.45, 0.25, 0.11), rings * 0.7 + grain * 0.3);
  return col * (0.55 + 0.45 * plank);
}

vec3 dipperWood(vec3 p) {
  vec3 q = p - uDipperPos;
  float grain = noise2(vec2(atan(q.z, q.x) * 3.0 + uDipperAngle * 3.0, q.y * 40.0));
  return mix(vec3(0.62, 0.42, 0.22), vec3(0.78, 0.58, 0.34), grain);
}

float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0;
  float t = 0.01;
  for (int i = 0; i < 40; i++) {
    float h = sceneSDF(ro + rd * t);
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.01, 0.2);
    if (res < 0.01 || t > 2.5) break;
  }
  return clamp(res, 0.0, 1.0);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rdView = vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0);
  vec3 rd = normalize(mat3(uCameraWorld) * rdView);
  vec3 ro = uCameraWorld[3].xyz;

  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < 128; i++) {
    float d = sceneSDF(ro + rd * t);
    if (d < 0.0005 * t) {
      hit = true;
      break;
    }
    t += d;
    if (t > 12.0) break;
  }
  if (!hit) {
    outColor = vec4(environment(rd), 0.0);
    return;
  }

  vec3 p = ro + rd * t;
  vec3 n = sceneNormal(p);
  vec3 albedo;
  float gloss;
  if (dipperSDF(p) < 0.002) {
    albedo = dipperWood(p);
    gloss = 0.15;
    // A coat of liquid on the lower grooves while drizzling.
    float coat = uCoat.a * smoothstep(DIPPER_HEAD * 0.9, DIPPER_HEAD * 0.4, p.y - uDipperPos.y);
    albedo = mix(albedo, uCoat.rgb, coat);
    gloss = mix(gloss, 1.0, coat);
  } else if (dishSDF(p) < 0.002) {
    albedo = vec3(0.86, 0.85, 0.82);
    gloss = 0.9;
  } else {
    albedo = woodTable(p);
    gloss = 0.25;
  }
  float shadow = softShadow(p + n * 0.003, KEY_DIR);
  float diffuse = max(dot(n, KEY_DIR), 0.0) * shadow;
  float ambient = 0.35 + 0.15 * n.y;
  vec3 col = albedo * (KEY_COLOR * diffuse + vec3(0.45, 0.4, 0.36) * ambient);
  vec3 refl = reflect(rd, n);
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
  col += gloss * fresnel * environment(refl) * mix(0.3, 1.0, shadow);
  col += gloss * KEY_COLOR * pow(max(dot(refl, KEY_DIR), 0.0), 120.0) * shadow;
  // Fade the table into the dark back of the room.
  col = mix(col, environment(rd) * 0.5, smoothstep(3.0, 7.0, t));

  float viewDepth = t * dot(rd, -mat3(uCameraWorld)[2]);
  outColor = vec4(col, viewDepth);
}
