uniform sampler2D uDepth;
uniform sampler2D uThickness;
uniform sampler2D uScene;
uniform mat4 uProj;
uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec3 uWaterColor;
uniform vec3 uAbsorption;
uniform float uRefraction;

in vec2 vUv;
out vec4 outColor;

vec3 viewPosAt(ivec2 p, vec2 invSize) {
  float depth = texelFetch(uDepth, p, 0).r;
  vec2 ndc = (vec2(p) + 0.5) * invSize * 2.0 - 1.0;
  return vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0) * depth;
}

// Shades the smoothed fluid surface: normals from depth, Fresnel reflection of the
// environment, refraction of the background, and Beer-Lambert absorption by thickness.
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 size = vec2(textureSize(uDepth, 0));
  vec2 invSize = 1.0 / size;
  float depth = texelFetch(uDepth, p, 0).r;

  if (depth <= 0.0) {
    outColor = texture(uScene, vUv);
    gl_FragDepth = 0.0;
    return;
  }

  vec3 pos = viewPosAt(p, invSize);
  ivec2 maxP = ivec2(size) - 1;
  ivec2 px1 = min(p + ivec2(1, 0), maxP), px0 = max(p - ivec2(1, 0), ivec2(0));
  ivec2 py1 = min(p + ivec2(0, 1), maxP), py0 = max(p - ivec2(0, 1), ivec2(0));
  float dxr = texelFetch(uDepth, px1, 0).r, dxl = texelFetch(uDepth, px0, 0).r;
  float dyu = texelFetch(uDepth, py1, 0).r, dyd = texelFetch(uDepth, py0, 0).r;

  // Use the one-sided difference with the smaller depth jump to avoid silhouette artifacts.
  vec3 ddx = viewPosAt(px1, invSize) - pos;
  vec3 ddx2 = pos - viewPosAt(px0, invSize);
  if (dxr <= 0.0 || (dxl > 0.0 && abs(ddx2.z) < abs(ddx.z))) ddx = ddx2;
  vec3 ddy = viewPosAt(py1, invSize) - pos;
  vec3 ddy2 = pos - viewPosAt(py0, invSize);
  if (dyu <= 0.0 || (dyd > 0.0 && abs(ddy2.z) < abs(ddy.z))) ddy = ddy2;
  vec3 n = normalize(cross(ddx, ddy));

  mat3 camRot = mat3(uCameraWorld);
  vec3 viewDir = normalize(-pos);
  vec3 worldN = normalize(camRot * n);
  vec3 worldV = normalize(camRot * viewDir);
  vec3 worldPos = (uCameraWorld * vec4(pos, 1.0)).xyz;

  float thickness = texture(uThickness, vUv).r;
  float cosTheta = clamp(dot(n, viewDir), 0.0, 1.0);
  float fresnel = 0.05 + 0.95 * pow(1.0 - cosTheta, 5.0);

  vec3 reflDir = reflect(-worldV, worldN);
  vec3 reflection = environment(worldPos, reflDir);

  vec2 refrUv = clamp(vUv + n.xy * uRefraction * min(thickness, 1.0), vec2(0.0), vec2(1.0));
  vec3 behind = texture(uScene, refrUv).rgb;
  vec3 transmittance = exp(-uAbsorption * thickness);
  float diffuse = 0.7 + 0.6 * max(dot(worldN, uSunDir), 0.0) + 0.2 * worldN.y;
  vec3 refraction = behind * transmittance + uWaterColor * diffuse * (1.0 - transmittance);

  vec3 halfVec = normalize(uSunDir + worldV);
  float specular = pow(max(dot(worldN, halfVec), 0.0), 400.0) * 3.0;

  vec3 color = mix(refraction, reflection, fresnel) + vec3(1.0, 0.95, 0.85) * specular;
  color = color / (1.0 + color * 0.15);
  outColor = vec4(color, 1.0);

  vec4 clip = uProj * vec4(pos, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
}
