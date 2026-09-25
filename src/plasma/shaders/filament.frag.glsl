uniform vec3 uCameraPos;

in float vAcross;
in float vIntensity;
in vec3 vColor;
in vec3 vWorld;
out vec4 outColor;

void main() {
  // Hidden behind the electrode.
  vec3 rd = vWorld - uCameraPos;
  float len = length(rd);
  rd /= len;
  vec2 e = sphereHit(uCameraPos, rd, ELECTRODE_RADIUS);
  if (e.x > 0.0 && e.x < len - 0.002) discard;

  float d = abs(vAcross) * 5.0;
  float core = exp(-d * d);
  float halo = exp(-d * 1.1) * (1.0 - abs(vAcross));
  vec3 hot = mix(vColor, vec3(1.0), 0.65);
  vec3 c = hot * core * 2.6 + vColor * (core * 0.8 + halo * 0.3);
  outColor = vec4(c * vIntensity, 0.0);
}
