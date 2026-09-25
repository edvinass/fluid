// Photo-studio backdrop: soft gradient sky and a floor whose shadow under the tank is tinted by
// the paint the light passes through. Requires grid.glsl (for sampling the paint volume).
uniform sampler2D uDye;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uFloorColor;
uniform vec3 uSunDir;
uniform float uFloorY;
uniform vec3 uBoxHalf;
uniform float uPaintDensity;

vec3 sky(vec3 rd) {
  float up = clamp(rd.y, -1.0, 1.0);
  vec3 col = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 0.9, up));
  float sun = max(dot(rd, uSunDir), 0.0);
  col += vec3(1.0, 0.97, 0.9) * (pow(sun, 600.0) * 2.0 + pow(sun, 12.0) * 0.08);
  return col;
}

bool boxHit(vec3 ro, vec3 rd, out float t0, out float t1) {
  vec3 inv = 1.0 / rd;
  vec3 a = (-uBoxHalf - ro) * inv;
  vec3 b = (uBoxHalf - ro) * inv;
  vec3 lo = min(a, b);
  vec3 hi = max(a, b);
  t0 = max(max(lo.x, lo.y), lo.z);
  t1 = min(min(hi.x, hi.y), hi.z);
  return t1 > max(t0, 0.0);
}

vec3 toCell(vec3 world) {
  return (world + uBoxHalf) / (2.0 * uBoxHalf) * vec3(uRes);
}

// Light reaching a floor point: soft contact shadow from the tank plus colour filtered by paint.
vec3 floorLight(vec3 hit) {
  float t0, t1;
  vec3 light = vec3(1.0);
  if (boxHit(hit, uSunDir, t0, t1)) {
    t0 = max(t0, 0.0);
    const int STEPS = 36;
    float ds = (t1 - t0) / float(STEPS);
    float jitter = fract(sin(dot(hit.xz, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 optical = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
      vec4 d = sample3D(uDye, toCell(hit + uSunDir * (t0 + (float(i) + jitter) * ds)));
      if (d.a > 1e-3) {
        vec3 pigment = d.rgb / d.a;
        optical += d.a * (1.0 - pigment * 0.85) * ds;
      }
    }
    light *= exp(-optical * uPaintDensity * 0.35);
    light *= 0.93;
  }
  // Ambient occlusion under the tank footprint.
  vec2 q = abs(hit.xz) - uBoxHalf.xz;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float ao = 1.0 - 0.25 * (1.0 - smoothstep(-0.2, 0.5, d));
  return light * ao;
}

vec3 studio(vec3 ro, vec3 rd, bool withShadows) {
  if (rd.y < -1e-4) {
    float t = (uFloorY - ro.y) / rd.y;
    if (t > 0.0) {
      vec3 hit = ro + rd * t;
      vec3 floorCol = uFloorColor * (withShadows ? floorLight(hit) : vec3(1.0));
      float fade = exp(-t * 0.07);
      return mix(sky(rd), floorCol, fade);
    }
  }
  return sky(rd);
}
