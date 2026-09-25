uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec3 uTunnelFloor;
uniform vec3 uGridColor;

in vec2 vUv;
out vec4 outColor;

// Studio backdrop with the tunnel's gridded floor, smoke-tinted light and the object's shadow.
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(mat3(uCameraWorld) * vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0));
  vec3 ro = uCameraWorld[3].xyz;
  vec3 color = sky(rd);
  if (rd.y < -1e-4) {
    float t = (uFloorY - ro.y) / rd.y;
    if (t > 0.0) {
      vec3 hit = ro + rd * t;
      vec3 base = uFloorColor;
      vec2 q = abs(hit.xz) - uBoxHalf.xz;
      if (max(q.x, q.y) < 0.0) {
        vec2 g = abs(fract(hit.xz * 10.0 + 0.5) - 0.5) / fwidth(hit.xz * 10.0);
        float line = 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
        base = mix(uTunnelFloor, uGridColor, line * 0.6);
      }
      float shadow = obstacleShadow(hit + vec3(0.0, 0.002, 0.0), uSunDir);
      vec3 light = floorLight(hit) * mix(0.45, 1.0, shadow);
      color = mix(color, base * light, exp(-t * 0.07));
    }
  }
  outColor = vec4(color, 1.0);
}
