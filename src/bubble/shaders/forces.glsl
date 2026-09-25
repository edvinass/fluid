uniform samplerCube uVel;
uniform samplerCube uCurl;
uniform samplerCube uFilm; // r = thickness in micrometres
uniform float uDt;
uniform float uVorticity;
uniform float uConvection;
uniform float uMeanThickness;
uniform float uTurbulence;
uniform float uDrag;

const int MAX_STIRS = 2;
uniform int uStirCount;
uniform vec4 uStirPos[MAX_STIRS]; // xyz = point on the sphere, w = angular radius
uniform vec3 uStirVel[MAX_STIRS];

out vec4 outVel;

// Thick film is heavier and slides down, thin film rises; vorticity confinement keeps the eddies
// alive; a gentle curl-noise breeze and the user's finger stir the film.
void main() {
  vec3 p = texelDir(vec2(0.0));
  Neighbours nb = neighbours(p);
  vec3 v = texture(uVel, p).xyz;

  float w = texture(uCurl, p).r;
  vec3 gradW = gradient(nb, abs(vec4(texture(uCurl, nb.q[0]).r, texture(uCurl, nb.q[1]).r, texture(uCurl, nb.q[2]).r, texture(uCurl, nb.q[3]).r)));
  float gradLen = length(gradW);
  float cell = 0.5 * (nb.a[0] + nb.a[1]);
  if (gradLen > 1e-5) v += uVorticity * cell * w * cross(gradW / gradLen, p) * uDt;

  float h = texture(uFilm, p).r;
  vec3 down = toTangent(vec3(0.0, -1.0, 0.0), p);
  v += down * uConvection * (h - uMeanThickness) * uDt;

  // Curl noise: the rotated gradient of a drifting noise field, which is divergence-free.
  float e = 0.02;
  vec3 np = p * 2.5 + vec3(0.0, uTime * 0.07, uTime * 0.05);
  vec3 g = vec3(noise3(np + vec3(e, 0, 0)) - noise3(np - vec3(e, 0, 0)),
    noise3(np + vec3(0, e, 0)) - noise3(np - vec3(0, e, 0)),
    noise3(np + vec3(0, 0, e)) - noise3(np - vec3(0, 0, e))) / (2.0 * e);
  v += cross(p, toTangent(g, p)) * uTurbulence * uDt;

  for (int i = 0; i < MAX_STIRS; i++) {
    if (i >= uStirCount) break;
    float d = acos(clamp(dot(p, uStirPos[i].xyz), -1.0, 1.0)) / uStirPos[i].w;
    v = mix(v, toTangent(uStirVel[i], p), clamp(exp(-d * d) * 0.8, 0.0, 1.0));
  }
  outVel = vec4(toTangent(v, p) * exp(-uDrag * uDt), 0.0);
}
