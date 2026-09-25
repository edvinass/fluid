uniform sampler2D uDepth;
uniform sampler2D uColor; // rgb = sqrt of albedo, a = material code / 8
uniform sampler2D uParticle; // xyz = world centre of the nearest particle, w = its seed
uniform float uGrainSize; // world units
uniform sampler2D uScene;
uniform mat4 uCameraWorld;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uExposure;

in vec2 vUv;
out vec4 outColor;

vec3 viewPosAt(ivec2 p, vec2 invSize) {
  float depth = texelFetch(uDepth, p, 0).r;
  vec2 ndc = (vec2(p) + 0.5) * invSize * 2.0 - 1.0;
  return vec3(ndc.x * uTanHalfFov * uAspect, ndc.y * uTanHalfFov, -1.0) * depth;
}

// Cellular noise: the nearest and second-nearest feature points around x. Each cell is one grain.
// Only the 8 nearest cells are searched, which is occasionally wrong but invisible at grain scale.
void voronoi(vec3 x, out float f1, out float f2, out vec3 toFeature, out vec3 cell) {
  vec3 i = floor(x - 0.5);
  vec3 f = x - i;
  f1 = 8.0;
  f2 = 8.0;
  for (int k = 0; k <= 1; k++) {
    for (int j = 0; j <= 1; j++) {
      for (int h = 0; h <= 1; h++) {
        vec3 g = vec3(h, j, k);
        vec3 r = g + 0.1 + 0.8 * hash33(i + g) - f;
        float d = dot(r, r);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          toFeature = r;
          cell = i + g;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
  }
  f1 = sqrt(f1);
  f2 = sqrt(f2);
}

vec3 grainColor(int material, vec3 r) {
  vec3 c = mix(vec3(0.53, 0.38, 0.2), vec3(0.62, 0.46, 0.25), r.x);
  if (r.y > 0.97) c = vec3(0.22, 0.18, 0.14) + 0.1 * r.z;
  else if (r.y > 0.88) c = mix(vec3(0.68, 0.6, 0.48), vec3(0.76, 0.7, 0.6), r.z);
  else if (r.y > 0.8) c = mix(vec3(0.5, 0.3, 0.15), vec3(0.56, 0.35, 0.18), r.z);
  return material == 1 ? c * vec3(0.42, 0.38, 0.34) : c;
}

vec3 finish(vec3 c) {
  return pow(aces(c * uExposure), vec3(1.0 / 2.2));
}

// Lights the granular surface: diffuse with shadows and crevice occlusion for sand, soft wrapped
// light and glints for snow, and glossy highlights for wet sand and jelly.
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 size = vec2(textureSize(uDepth, 0));
  vec2 invSize = 1.0 / size;
  float depth = texelFetch(uDepth, p, 0).r;
  vec4 scene = texture(uScene, vUv);
  if (depth <= 0.0 || (scene.a > 0.0 && depth > scene.a + 0.01)) {
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
  vec3 wp = camRot * pos + uCameraWorld[3].xyz;

  vec4 grain = texelFetch(uColor, p, 0);
  vec3 albedo = grain.rgb * grain.rgb;
  int material = int(grain.a * 8.0);
  float contact = 1.0;
  if (material <= 1) {
    // Real sand grains are far smaller than the simulated particles, so each particle's surface is
    // covered in tiny grains: cells of a Voronoi pattern anchored to the particle so they move
    // with it. Each grain is a rounded pebble with its own mineral colour, darker where it meets
    // its neighbours. When grains shrink below a pixel they fade to their average.
    vec4 particle = texelFetch(uParticle, p, 0);
    vec3 local = (wp - particle.xyz) / uGrainSize + particle.w * vec3(173.1, 91.7, 57.3);
    float f1, f2;
    vec3 toFeature, cell;
    voronoi(local, f1, f2, toFeature, cell);
    float pixelWorld = depth * 2.0 * uTanHalfFov / size.y;
    float detail = 1.0 - smoothstep(0.7, 1.4, pixelWorld / uGrainSize);
    vec3 tint = albedo / (material == 1 ? vec3(0.245, 0.15, 0.068) : vec3(0.56, 0.4, 0.2));
    vec3 grainAlbedo = grainColor(material, hash33(cell * 1.37 + 11.0)) * tint;
    vec3 meanAlbedo = (material == 1 ? vec3(0.23, 0.155, 0.08) : vec3(0.56, 0.41, 0.22)) * tint;
    albedo = mix(meanAlbedo, grainAlbedo, detail);
    vec3 bump = -toFeature;
    bump -= N * dot(bump, N);
    N = normalize(N + bump * 0.9 * detail);
    contact = mix(0.92, mix(0.7, 1.0, smoothstep(0.0, 0.25, f2 - f1)), detail);
  } else if (material == 2) {
    // Detail finer than the simulated particles: roughen the snow and vary its colour.
    vec3 q = wp * 230.0;
    vec3 bump = vec3(noise3(q), noise3(q + 17.1), noise3(q + 41.7)) - 0.5;
    N = normalize(N + bump * 0.3);
    albedo *= 0.78 + 0.44 * noise3(wp * 380.0);
  }

  // Crevices: nearby surface in front of this pixel blocks some of the sky.
  float occlusion = 0.0;
  float reach = 0.035 * size.y / (2.0 * uTanHalfFov * depth);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785 + hash12(vec2(p)) * 0.785;
    ivec2 q = clamp(p + ivec2(vec2(cos(a), sin(a)) * reach * (0.4 + 0.6 * float(i & 1))), ivec2(0), maxP);
    float dq = texelFetch(uDepth, q, 0).r;
    if (dq > 0.0) occlusion += clamp((depth - dq) / 0.03, 0.0, 1.0);
  }
  float ao = (1.0 - occlusion / 8.0 * 0.8) * contact;

  float shadow = grainShadow(wp + N * 0.012) * softShadow(wp + N * 0.01, KEY_DIR);
  float ndl = dot(N, KEY_DIR);
  vec3 skyLight = vec3(0.45, 0.42, 0.4) * (0.6 + 0.4 * N.y);
  vec3 H = normalize(KEY_DIR + V);
  float nh = max(dot(N, H), 0.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 col;

  if (material == 2) {
    // Snow: light scatters through it, so it wraps into the shade, which goes blue from the sky.
    float wrap = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);
    col = albedo * (KEY_COLOR * wrap * mix(0.35, 1.0, shadow) + vec3(0.36, 0.44, 0.6) * ao);
    // Ice crystals catch the light and sparkle.
    float cell = hash13(floor(wp * 350.0));
    float glint = step(0.985, cell) * pow(nh, 12.0) * shadow;
    col += KEY_COLOR * glint * 3.0;
    col += fresnel * environment(R) * 0.15;
  } else {
    float diffuse = max(ndl, 0.0) * shadow * contact;
    col = albedo * (KEY_COLOR * diffuse + skyLight * ao);
    float gloss = material == 1 ? 0.04 : material == 3 ? 1.0 : material == 4 ? 0.3 : material == 5 ? 0.25 : 0.0;
    float shininess = material == 3 ? 400.0 : material == 1 ? 30.0 : 60.0;
    col += gloss * (fresnel * environment(R) * mix(0.4, 1.0, shadow) * ao + KEY_COLOR * pow(nh, shininess) * shadow * 2.0);
    if (material == 3) col += albedo * albedo * 0.5; // light glowing through the jelly
  }
  outColor = vec4(finish(col), 1.0);
}
