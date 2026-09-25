uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;

in vec2 vUv;
out vec4 outColor; // rgb = linear colour, a = view depth (0 for the far background)

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
  vec3 col = mix(vec3(0.2, 0.1, 0.05), vec3(0.34, 0.19, 0.09), rings * 0.7 + grain * 0.3);
  return col * (0.55 + 0.45 * plank);
}

vec3 pine(vec3 p, vec3 n) {
  // Grain runs along each board: x on the walls facing z, z on the walls facing x and the floor.
  float along = abs(n.x) > 0.5 ? p.z : p.x;
  float across = abs(n.y) > 0.5 ? p.z : p.y;
  float grain = noise2(vec2(along * 4.0, across * 60.0) + noise2(vec2(along, across) * 9.0) * 1.5);
  return mix(vec3(0.5, 0.33, 0.16), vec3(0.68, 0.49, 0.27), grain);
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
    outColor = vec4(environment(rd) * 0.8, 0.0);
    return;
  }

  vec3 p = ro + rd * t;
  vec3 n = sceneNormal(p);
  vec3 albedo;
  float gloss;
  if (ballSDF(p) < 0.002) {
    albedo = vec3(0.55, 0.04, 0.03);
    gloss = 0.7;
  } else if (traySDF(p) < 0.002) {
    albedo = pine(p, n);
    gloss = 0.08;
  } else {
    albedo = woodTable(p);
    gloss = 0.25;
  }
  float shadow = softShadow(p + n * 0.003, KEY_DIR) * grainShadow(p + n * 0.01);
  float diffuse = max(dot(n, KEY_DIR), 0.0) * shadow;
  float ambient = 0.35 + 0.15 * n.y;
  vec3 col = albedo * (KEY_COLOR * diffuse + vec3(0.45, 0.4, 0.36) * ambient);
  vec3 refl = reflect(rd, n);
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
  col += gloss * fresnel * environment(refl) * mix(0.3, 1.0, shadow);
  col += gloss * KEY_COLOR * pow(max(dot(refl, KEY_DIR), 0.0), 120.0) * shadow;
  col = mix(col, environment(rd) * 0.5, smoothstep(3.0, 7.0, t));

  float viewDepth = t * dot(rd, -mat3(uCameraWorld)[2]);
  outColor = vec4(col, viewDepth);
}
