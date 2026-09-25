in vec2 vUv;
out vec4 outColor;

void main() {
  vec3 rd = cameraRay(vUv);
  outColor = vec4(backdrop(uCameraWorld[3].xyz, rd), 1.0);
}
