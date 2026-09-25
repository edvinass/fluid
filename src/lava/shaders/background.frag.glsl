in vec2 vUv;
out vec4 outColor; // rgb = linear colour, a = view depth (0 for the far background)

float coneSDF(vec3 p, float y0, float r0, float y1, float r1) {
  float t = clamp((p.y - y0) / (y1 - y0), 0.0, 1.0);
  return max((length(p.xz) - mix(r0, r1, t)) * 0.9, max(y0 - p.y, p.y - y1));
}

float baseSDF(vec3 p) {
  return coneSDF(p, TABLE_Y, BASE_R, LAMP_BOTTOM, R_BOTTOM + GLASS + 0.01);
}

float capSDF(vec3 p) {
  return coneSDF(p, LAMP_TOP, R_TOP + GLASS + 0.01, CAP_TOP, CAP_R);
}

// The heating coil the wax rests on, a flat disc at the bottom of the vessel.
float coilSDF(vec3 p) {
  vec3 q = p - vec3(0.0, LAMP_BOTTOM + 0.004, 0.0);
  vec2 d = vec2(length(q.xz) - 0.11, abs(q.y) - 0.004);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sceneSDF(vec3 p) {
  return min(min(p.y - TABLE_Y, baseSDF(p)), min(capSDF(p), coilSDF(p)));
}

vec3 sceneNormal(vec3 p) {
  const vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
    sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
    sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)));
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  vec3 rd = cameraRay(vUv);
  vec3 ro = uCameraWorld[3].xyz;
  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < 128; i++) {
    float d = sceneSDF(ro + rd * t);
    if (d < 0.0004 * t) {
      hit = true;
      break;
    }
    t += d;
    if (t > 15.0) break;
  }
  if (!hit) {
    outColor = vec4(environment(rd), 0.0);
    return;
  }

  vec3 p = ro + rd * t;
  vec3 n = sceneNormal(p);
  vec3 refl = reflect(rd, n);
  vec3 col;
  if (p.y < TABLE_Y + 0.001) {
    // A dark wooden table, lit by the lamp.
    vec2 q = p.xz * vec2(1.0, 7.0);
    float grain = noise2(q * 3.0 + noise2(q * 0.6) * 2.0);
    vec3 albedo = mix(vec3(0.07, 0.035, 0.02), vec3(0.16, 0.08, 0.04), grain);
    col = albedo * (lampLight(p, n) * 2.2 + vec3(0.02, 0.02, 0.03));
    float fresnel = 0.03 + 0.97 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
    col += fresnel * 0.4 * environment(refl);
    col = mix(col, environment(rd), smoothstep(2.5, 7.0, t));
  } else if (coilSDF(p) < 0.002) {
    col = vec3(0.12, 0.1, 0.09) * (uGlowColor + 0.3);
  } else {
    // Brushed metal base and cap: they mirror the room and catch the glow of the vessel.
    vec3 tint = vec3(0.85, 0.82, 0.78);
    vec3 toLamp = normalize(LAMP_CENTER - p);
    float facing = pow(max(dot(refl, toLamp), 0.0), 6.0);
    col = tint * (environment(refl) * 1.5 + (uGlowColor * 1.2 + uWaxColor * 0.3) * facing * 0.9);
    col += tint * lampLight(p, n) * 0.3;
    float bands = 0.9 + 0.1 * sin(p.y * 900.0);
    col *= bands;
  }
  float viewDepth = t * dot(rd, -mat3(uCameraWorld)[2]);
  outColor = vec4(col, viewDepth);
}
