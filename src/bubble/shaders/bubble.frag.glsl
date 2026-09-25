uniform samplerCube uFilm;
uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec3 uCenter;
uniform float uRadius;
uniform vec4 uPop; // xyz = where it burst (unit direction), w = angular radius of the hole (< 0 while intact)
uniform int uEnv; // 0 studio, 1 daylight
uniform float uExposure;
uniform float uFilmIndex;

in vec2 vUv;
out vec4 outColor;

// CIE 1931 colour matching functions, multi-lobe Gaussian fit (Wyman, Sloan and Shirley 2013).
vec3 cie(float l) {
  float t1 = (l - 442.0) * (l < 442.0 ? 0.0624 : 0.0374);
  float t2 = (l - 599.8) * (l < 599.8 ? 0.0264 : 0.0323);
  float t3 = (l - 501.1) * (l < 501.1 ? 0.049 : 0.0382);
  float t4 = (l - 568.8) * (l < 568.8 ? 0.0213 : 0.0247);
  float t5 = (l - 530.9) * (l < 530.9 ? 0.0613 : 0.0322);
  float t6 = (l - 437.0) * (l < 437.0 ? 0.0845 : 0.0278);
  float t7 = (l - 459.0) * (l < 459.0 ? 0.0385 : 0.0725);
  return vec3(
    0.362 * exp(-0.5 * t1 * t1) + 1.056 * exp(-0.5 * t2 * t2) - 0.065 * exp(-0.5 * t3 * t3),
    0.821 * exp(-0.5 * t4 * t4) + 0.286 * exp(-0.5 * t5 * t5),
    1.217 * exp(-0.5 * t6 * t6) + 0.681 * exp(-0.5 * t7 * t7));
}

const mat3 XYZ_TO_RGB = mat3(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.204, -0.4986, 0.0415, 1.057);

// Reflectance of a soap film of the given thickness (micrometres): light reflected off its front
// and back faces interferes, cancelling some wavelengths and reinforcing others. Summed over the
// visible spectrum and normalised so a perfect mirror would be white.
vec3 filmReflectance(float thickness, float cosI) {
  float n = uFilmIndex;
  float cosT = sqrt(max(1.0 - (1.0 - cosI * cosI) / (n * n), 0.0));
  float rs = (cosI - n * cosT) / (cosI + n * cosT);
  float rp = (n * cosI - cosT) / (n * cosI + cosT);
  float d = thickness * 1000.0;
  vec3 xyz = vec3(0.0);
  vec3 white = vec3(0.0);
  const int SAMPLES = 16;
  for (int i = 0; i < SAMPLES; i++) {
    float l = 400.0 + 300.0 * (float(i) + 0.5) / float(SAMPLES);
    float c = cos(12.566370614 * n * d * cosT / l);
    float r2s = rs * rs;
    float r2p = rp * rp;
    float r = 0.5 * (2.0 * r2s * (1.0 - c) / (1.0 + r2s * r2s - 2.0 * r2s * c)
      + 2.0 * r2p * (1.0 - c) / (1.0 + r2p * r2p - 2.0 * r2p * c));
    vec3 m = cie(l);
    xyz += m * r;
    white += m;
  }
  return max((XYZ_TO_RGB * xyz) / (XYZ_TO_RGB * white), 0.0);
}

// Softbox in the camera's frame: a bright rectangle facing the subject.
float softbox(vec3 d, vec3 center, vec3 up, vec2 halfSize) {
  vec3 f = normalize(center);
  vec3 r = normalize(cross(up, f));
  vec3 u = cross(f, r);
  float z = dot(d, f);
  if (z <= 0.0) return 0.0;
  vec2 q = vec2(dot(d, r), dot(d, u)) / z;
  vec2 e = abs(q) - halfSize;
  float edge = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - 0.08;
  return smoothstep(0.12, -0.12, edge) * (1.0 - 0.3 * dot(q / halfSize, q / halfSize));
}

// Photo studio lit from behind the camera, so the lighting follows the view as you orbit. The
// backdrop behind the bubble stays dark to make the film colours stand out.
vec3 studioEnv(vec3 dirWorld) {
  vec3 d = transpose(mat3(uCameraWorld)) * dirWorld;
  vec3 col = mix(vec3(0.022, 0.024, 0.034), vec3(0.003, 0.003, 0.005), clamp(length(d.xy) * 1.2, 0.0, 1.0));
  col += vec3(0.55, 0.56, 0.62) * smoothstep(-0.2, 0.8, d.z) * (0.75 + 0.35 * d.y);
  col += vec3(1.0, 0.97, 0.92) * 3.5 * softbox(d, vec3(0.5, 0.4, 1.0), vec3(0.0, 1.0, 0.0), vec2(0.3, 0.22));
  col += vec3(0.88, 0.94, 1.0) * 2.0 * softbox(d, vec3(-0.9, 0.05, 0.6), vec3(0.0, 1.0, 0.0), vec2(0.06, 0.5));
  col += vec3(1.0) * 1.2 * softbox(d, vec3(0.0, 1.0, 0.2), vec3(0.0, 0.0, -1.0), vec2(0.35, 0.1));
  return col;
}

vec3 dayEnv(vec3 d) {
  vec3 sunDir = normalize(vec3(0.5, 0.55, 0.65));
  vec3 horizon = vec3(0.7, 0.8, 0.92);
  vec3 col;
  if (d.y > 0.0) {
    col = mix(horizon, vec3(0.16, 0.36, 0.8), pow(d.y, 0.4));
    vec2 cp = d.xz / (d.y + 0.12) * 1.4 + vec2(uTime * 0.01, 0.0);
    float c = noise3(vec3(cp, 0.0)) * 0.55 + noise3(vec3(cp * 2.3, 1.0)) * 0.3 + noise3(vec3(cp * 5.1, 2.0)) * 0.15;
    col = mix(col, vec3(1.0), smoothstep(0.56, 0.8, c) * 0.9 * smoothstep(0.0, 0.25, d.y));
  } else {
    float g = noise3(vec3(d.xz / (-d.y + 0.05) * 3.0, 3.0));
    vec3 grass = vec3(0.09, 0.17, 0.05) * (0.75 + 0.5 * g);
    col = mix(horizon * 0.8, grass, smoothstep(0.0, 0.12, -d.y));
  }
  float s = max(dot(d, sunDir), 0.0);
  col += vec3(1.0, 0.95, 0.85) * (pow(s, 900.0) * 80.0 + pow(s, 10.0) * 0.35);
  return col * 1.25;
}

vec3 environment(vec3 d) {
  return uEnv == 0 ? studioEnv(d) : dayEnv(d);
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// How much of the film exists at this point: gone inside the burst hole, with a bright rim of
// gathered liquid at its edge.
float filmPresent(vec3 n, out float rim) {
  rim = 0.0;
  if (uPop.w < 0.0) return 1.0;
  float a = acos(clamp(dot(n, uPop.xyz), -1.0, 1.0)) - uPop.w;
  rim = exp(-a * a / 0.0005) * step(0.0, a);
  return step(0.0, a);
}

vec3 shadeSurface(vec3 p, vec3 rd, vec3 color, bool front) {
  vec3 n = (p - uCenter) / uRadius;
  float rim;
  if (filmPresent(n, rim) < 0.5) return color;
  float cosI = abs(dot(rd, n));
  float h = texture(uFilm, n).r;
  vec3 R = filmReflectance(h, cosI);
  vec3 reflected = environment(reflect(rd, front ? n : -n));
  color = R * reflected + (1.0 - R) * color;
  return color + rim * vec3(0.8, 0.82, 0.9);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(mat3(uCameraWorld) * vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0));
  vec3 ro = uCameraWorld[3].xyz;
  vec3 color = environment(rd);

  if (uRadius > 0.0) {
    vec3 oc = ro - uCenter;
    float b = dot(oc, rd);
    float h = b * b - dot(oc, oc) + uRadius * uRadius;
    if (h > 0.0) {
      h = sqrt(h);
      color = shadeSurface(ro + rd * (-b + h), rd, color, false);
      if (-b - h > 0.0) color = shadeSurface(ro + rd * (-b - h), rd, color, true);
    }
  }
  color = aces(color * uExposure);
  outColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);
}
