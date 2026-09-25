uniform samplerCube uVel;
uniform samplerCube uFilm; // thickness at the start of the step
uniform samplerCube uForward;
uniform samplerCube uBackward;
uniform float uDt;
uniform float uDrain;
uniform float uEvaporation;

const int MAX_PLUMES = 4;
uniform int uPlumeCount;
uniform vec4 uPlumePos[MAX_PLUMES]; // xyz = point on the sphere, w = angular radius
uniform float uPlumeThin[MAX_PLUMES]; // fraction of the thickness removed per second at the centre

out vec4 outFilm;

// MacCormack correction of the film thickness (clamped to the values it came from), then drainage:
// gravity pulls liquid from the top of the bubble to the bottom, and patches of thin film are
// born near the bottom, where they rise as colourful plumes.
void main() {
  vec3 p = texelDir(vec2(0.0));
  vec3 mid = normalize(p - 0.5 * uDt * texture(uVel, p).xyz);
  vec3 back = normalize(p - uDt * texture(uVel, mid).xyz);

  float h = texture(uForward, p).r + 0.5 * (texture(uFilm, p).r - texture(uBackward, p).r);
  Neighbours nb = neighbours(p);
  float lo = texture(uFilm, back).r;
  float hi = lo;
  for (int k = 0; k < 4; k++) {
    float s = texture(uFilm, normalize(back + nb.t[k] * nb.a[k])).r;
    lo = min(lo, s);
    hi = max(hi, s);
  }
  h = clamp(h, lo, hi);

  h -= uDt * (uDrain * p.y * h + uEvaporation * h);
  for (int i = 0; i < MAX_PLUMES; i++) {
    if (i >= uPlumeCount) break;
    float d = acos(clamp(dot(p, uPlumePos[i].xyz), -1.0, 1.0)) / uPlumePos[i].w;
    h -= h * uPlumeThin[i] * exp(-d * d) * uDt;
  }
  outFilm = vec4(clamp(h, 0.0, 2.0), 0.0, 0.0, 1.0);
}
