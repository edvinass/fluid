uniform sampler2D uBackdrop;
uniform sampler2D uVolume;
uniform sampler2D uBloom0;
uniform sampler2D uBloom1;
uniform sampler2D uBloom2;
uniform float uBloom;
uniform float uExposure;

in vec2 vUv;
out vec4 outColor;

vec3 shadeScenery(vec3 p, vec3 rd) {
  vec3 n = sceneNormal(p);
  int material = sceneMaterial(p);
  vec3 l;
  float dist;
  vec3 light = fireLight(p, l, dist);
  float diffuse = max(dot(n, l), 0.0) * 0.8 + 0.2 * max(dot(n, l) * 0.5 + 0.5, 0.0);
  vec3 ambient = vec3(0.006, 0.008, 0.014) * (0.6 + 0.4 * n.y);

  if (material == 0) {
    // Charred wood with glowing cracks wherever the flames are hot.
    float grain = noise3(p * vec3(18.0, 60.0, 18.0)) * 0.5 + noise3(p * 90.0) * 0.5;
    vec3 albedo = mix(vec3(0.05, 0.035, 0.025), vec3(0.14, 0.09, 0.06), grain);
    float heat = sample3D(uState, toCell(p + n * uCellSize * 1.5)).r;
    float cracks = smoothstep(0.55, 0.8, noise3(p * 55.0 + vec3(0.0, 0.0, 3.0)));
    float glow = cracks * smoothstep(0.15, 0.9, heat) + smoothstep(0.12, 0.0, p.y - uGround) * 0.35 * float(heat > 0.1);
    return albedo * (light * diffuse + ambient) + flameColor(0.9 + heat * 0.6) * glow * 1.4;
  }
  if (material == 1) {
    float n2 = noise3(p * 30.0);
    vec3 albedo = mix(vec3(0.16, 0.15, 0.14), vec3(0.3, 0.28, 0.26), n2);
    return albedo * (light * diffuse + ambient);
  }
  vec3 h = normalize(l - rd);
  float spec = pow(max(dot(n, h), 0.0), 60.0);
  return vec3(0.05, 0.05, 0.055) * (light * diffuse + ambient) + light * spec * 0.6;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 rd = cameraRay(vUv);
  vec3 ro = uCameraWorld[3].xyz;
  vec3 color = texture(uBackdrop, vUv).rgb;
  float tHit;
  if (traceScene(ro, rd, 1e3, tHit)) color = shadeScenery(ro + rd * tHit, rd);

  vec4 vol = texture(uVolume, vUv);
  color = vol.rgb + vol.a * color;
  color += (texture(uBloom0, vUv).rgb * 0.5 + texture(uBloom1, vUv).rgb * 0.8 + texture(uBloom2, vUv).rgb) * uBloom;

  color = aces(color * uExposure);
  outColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);
}
