uniform vec3 uCameraPos;

in float vAcross;
in float vIntensity;
in vec3 vColor;
in vec3 vWorld;
in float vSpread;
in float vSeed;
out vec4 outColor;

const vec3 EDGE_BLUE = vec3(0.3, 0.38, 1.0);
const vec3 PALE = vec3(0.85, 0.85, 1.0);

void main() {
  // Hidden behind the electrode.
  vec3 rd = vWorld - uCameraPos;
  float len = length(rd);
  rd /= len;
  vec2 e = sphereHit(uCameraPos, rd, ELECTRODE_RADIUS);
  if (e.x > 0.0 && e.x < len - 0.002) discard;

  // A soft, translucent thread: paler along its middle, bluer towards its edges.
  float x = abs(vAcross);
  float core = exp(-x * x * mix(16.0, 10.0, vSpread));
  float halo = exp(-x * 4.0) * (1.0 - x);
  vec3 centre = mix(vColor, PALE, 0.05);
  vec3 edge = mix(vColor, EDGE_BLUE, 0.4);
  float shimmer = 0.8 + 0.4 * noise3(vWorld * 3.0 - normalize(vWorld) * uTime * 3.0 + vSeed);
  vec3 c = mix(edge, centre, core) * (core * 0.55 + halo * 0.22) * shimmer;
  outColor = vec4(c * vIntensity, 0.0);
}
