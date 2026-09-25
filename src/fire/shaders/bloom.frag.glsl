#version 300 es
precision highp float;

uniform sampler2D uSrc;
uniform vec2 uTexel; // 1 / source size
uniform vec2 uDir; // (0, 0) for a 4-tap downsample, otherwise the blur direction in source texels

in vec2 vUv;
out vec4 outColor;

// Downsamples with a box filter, or applies one direction of a 9-tap Gaussian using linear taps.
void main() {
  if (uDir == vec2(0.0)) {
    vec2 o = uTexel * 0.5;
    outColor = 0.25 * (texture(uSrc, vUv + vec2(-o.x, -o.y)) + texture(uSrc, vUv + vec2(o.x, -o.y))
      + texture(uSrc, vUv + vec2(-o.x, o.y)) + texture(uSrc, vUv + vec2(o.x, o.y)));
    outColor.a = 1.0;
    return;
  }
  vec2 d = uDir * uTexel;
  vec3 c = texture(uSrc, vUv).rgb * 0.2270270270;
  c += (texture(uSrc, vUv + d * 1.3846153846).rgb + texture(uSrc, vUv - d * 1.3846153846).rgb) * 0.3162162162;
  c += (texture(uSrc, vUv + d * 3.2307692308).rgb + texture(uSrc, vUv - d * 3.2307692308).rgb) * 0.0702702703;
  outColor = vec4(c, 1.0);
}
