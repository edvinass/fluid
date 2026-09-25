uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;

in vec2 vUv;
out vec4 outColor;

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(mat3(uCameraWorld) * vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0));
  vec3 ro = uCameraWorld[3].xyz;
  outColor = vec4(studio(ro, rd, true), 1.0);
}
