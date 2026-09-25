uniform sampler2D uScene; // rgb = light, a = distance to the nearest opaque surface
uniform sampler2D uBloom0;
uniform sampler2D uBloom1;
uniform sampler2D uBloom2;
uniform sampler2D uBloom3;
uniform float uBloom;
uniform float uExposure;

in vec2 vUv;
out vec4 outColor;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec4 scene = texture(uScene, vUv);
  vec3 color = scene.rgb;
  vec3 bloom = texture(uBloom0, vUv).rgb * 0.4 + texture(uBloom1, vUv).rgb * 0.3
    + texture(uBloom2, vUv).rgb * 0.2 + texture(uBloom3, vUv).rgb * 0.25;
  color += bloom * uBloom;

  // Reflections in the front of the glass.
  vec3 rd = cameraRay(vUv);
  vec3 ro = uCameraWorld[3].xyz;
  vec2 g = sphereHit(ro, rd, GLASS_RADIUS);
  if (g.x > 0.0 && g.x < scene.a) {
    vec3 n = normalize(ro + rd * g.x);
    float cosI = max(dot(-rd, n), 0.0);
    float f = 0.04 + 0.96 * pow(1.0 - cosI, 5.0);
    vec3 r = reflect(rd, n);
    color = color * (1.0 - f) + roomEnv(r) * f * 3.0;
  }

  color = aces(color * uExposure);
  vec2 c = vUv - 0.5;
  color *= 1.0 - dot(c, c) * 0.6;
  color = pow(color, vec3(1.0 / 2.2));
  color += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  outColor = vec4(color, 1.0);
}
