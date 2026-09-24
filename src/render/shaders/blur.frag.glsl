#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTex;
uniform ivec2 uDir;
uniform int uBilateral; // 1 = depth-aware blur for the depth buffer, 0 = plain gaussian
uniform float uWorldRadius;
uniform float uProjScale;
uniform float uDepthFalloff;
uniform int uMaxRadius;

out vec4 outValue;

// Separable blur. For depth, the kernel size shrinks with distance and samples across
// depth discontinuities are rejected so silhouettes stay crisp.
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(uTex, 0) - 1;
  float center = texelFetch(uTex, p, 0).r;
  if (uBilateral == 1 && center <= 0.0) {
    outValue = vec4(0.0);
    return;
  }

  float radius = uBilateral == 1
    ? min(float(uMaxRadius), uWorldRadius * uProjScale / center)
    : float(uMaxRadius);
  int r = int(ceil(radius));
  float sigma = max(radius * 0.5, 0.5);
  float invTwoSigma2 = 1.0 / (2.0 * sigma * sigma);
  float invFalloff2 = 1.0 / (uDepthFalloff * uDepthFalloff);

  float sum = 0.0;
  float weightSum = 0.0;
  for (int i = -r; i <= r; i++) {
    float s = texelFetch(uTex, clamp(p + uDir * i, ivec2(0), size), 0).r;
    float w = exp(-float(i * i) * invTwoSigma2);
    if (uBilateral == 1) {
      if (s <= 0.0) continue;
      float dz = s - center;
      w *= exp(-dz * dz * invFalloff2);
    }
    sum += s * w;
    weightSum += w;
  }
  outValue = vec4(weightSum > 0.0 ? sum / weightSum : center, 0.0, 0.0, 1.0);
}
