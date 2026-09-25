uniform sampler2D uDepth;
uniform sampler2D uThickness;
uniform sampler2D uScene;
uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec3 uAbsorption; // per world unit of thickness
uniform vec3 uScatter; // colour of light scattered inside the liquid
uniform float uRefraction;
uniform float uExposure;
// Overlapping particle spheres add up to far more than the liquid's real thickness; this scales the
// sum back to the particles' true volume.
uniform float uThicknessScale;

in vec2 vUv;
out vec4 outColor;

vec3 viewPosAt(ivec2 p, vec2 invSize) {
  float depth = texelFetch(uDepth, p, 0).r;
  vec2 ndc = (vec2(p) + 0.5) * invSize * 2.0 - 1.0;
  return vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0) * depth;
}

vec3 finish(vec3 c) {
  return pow(aces(c * uExposure), vec3(1.0 / 2.2));
}

// Shades the smoothed liquid surface: light passing through tints what's behind it by
// Beer-Lambert absorption, light scattered inside gives it body, and the surface reflects the room.
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 size = vec2(textureSize(uDepth, 0));
  vec2 invSize = 1.0 / size;
  float depth = texelFetch(uDepth, p, 0).r;
  vec4 scene = texture(uScene, vUv);
  // The tolerance lets the smoothed liquid edge overlap the dish slightly instead of being cut off.
  if (depth <= 0.0 || (scene.a > 0.0 && depth > scene.a + 0.04)) {
    outColor = vec4(finish(scene.rgb), 1.0);
    return;
  }

  vec3 pos = viewPosAt(p, invSize);
  ivec2 maxP = ivec2(size) - 1;
  ivec2 px1 = min(p + ivec2(1, 0), maxP), px0 = max(p - ivec2(1, 0), ivec2(0));
  ivec2 py1 = min(p + ivec2(0, 1), maxP), py0 = max(p - ivec2(0, 1), ivec2(0));
  float dxr = texelFetch(uDepth, px1, 0).r, dxl = texelFetch(uDepth, px0, 0).r;
  float dyu = texelFetch(uDepth, py1, 0).r, dyd = texelFetch(uDepth, py0, 0).r;
  vec3 ddx = viewPosAt(px1, invSize) - pos;
  vec3 ddx2 = pos - viewPosAt(px0, invSize);
  if (dxr <= 0.0 || (dxl > 0.0 && abs(ddx2.z) < abs(ddx.z))) ddx = ddx2;
  vec3 ddy = viewPosAt(py1, invSize) - pos;
  vec3 ddy2 = pos - viewPosAt(py0, invSize);
  if (dyu <= 0.0 || (dyd > 0.0 && abs(ddy2.z) < abs(ddy.z))) ddy = ddy2;
  vec3 n = normalize(cross(ddx, ddy));

  mat3 camRot = mat3(uCameraWorld);
  vec3 N = normalize(camRot * n);
  vec3 V = normalize(camRot * normalize(-pos));

  vec2 texel = 1.0 / vec2(textureSize(uThickness, 0));
  float thickness = texture(uThickness, vUv).r * uThicknessScale;
  float tr = texture(uThickness, vUv + vec2(6.0 * texel.x, 0.0)).r * uThicknessScale;
  float tl = texture(uThickness, vUv - vec2(6.0 * texel.x, 0.0)).r * uThicknessScale;
  float tu = texture(uThickness, vUv + vec2(0.0, 6.0 * texel.y)).r * uThicknessScale;
  float td = texture(uThickness, vUv - vec2(0.0, 6.0 * texel.y)).r * uThicknessScale;
  float around = (tr + tl + tu + td) * 0.25;
  // Where the surface curves down at an edge, light inside bounces around longer (the meniscus
  // looks darker and richer), so absorb as if it were a little thicker.
  float edge = smoothstep(0.01, 0.05, abs(tr - tl) + abs(tu - td));
  float absorbed = thickness + edge * 0.02;

  // Looking through the liquid: the dish behind is bent like through a lens, more so where the
  // liquid is thick, and tinted by Beer-Lambert absorption.
  vec2 refrUv = clamp(vUv + n.xy * uRefraction * clamp(thickness * 12.0, 0.0, 1.0), vec2(0.0), vec2(1.0));
  vec3 behind = texture(uScene, refrUv).rgb;
  vec3 transmittance = exp(-uAbsorption * absorbed);
  // Domes of liquid focus the light onto the dish below (bright caustics) and hollows spread it.
  float caustic = clamp(1.0 + (thickness - around) * 25.0, 0.8, 1.8);
  float wrap = 0.5 + 0.5 * dot(N, KEY_DIR);
  vec3 light = KEY_COLOR * wrap * 0.6 + vec3(0.45, 0.4, 0.36) * 0.6;
  vec3 body = behind * transmittance * caustic + uScatter * light * (1.0 - transmittance);

  float cosTheta = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - cosTheta, 5.0);
  vec3 R = reflect(-V, N);
  vec3 color = mix(body, environment(R), fresnel);
  // A crisp highlight of the window plus a soft sheen, which make the surface read as wet.
  float nh = max(dot(N, normalize(KEY_DIR + V)), 0.0);
  color += KEY_COLOR * (pow(nh, 900.0) * 6.0 + pow(nh, 80.0) * 0.18);
  outColor = vec4(finish(color), 1.0);
}
