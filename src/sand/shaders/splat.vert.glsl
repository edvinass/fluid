#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uPos; // w = material + particle seed
uniform int uTexW;
uniform mat4 uModelView;
uniform mat4 uProj;
uniform float uRadius;
uniform float uProjScale;

const float SAND_RADIUS_SCALE = 2.0;

out vec3 vViewCenter;
flat out float vRadius;
flat out vec4 vColor; // rgb = sqrt of linear albedo, a = material code / 8
flat out vec4 vParticle; // xyz = world centre, w = seed

vec3 particleColor(int material, float seed) {
  if (material == 0) return mix(vec3(0.52, 0.36, 0.18), vec3(0.6, 0.43, 0.23), seed);
  if (material == 1) return mix(vec3(0.22, 0.135, 0.06), vec3(0.27, 0.17, 0.075), seed);
  if (material == 2) return mix(vec3(0.82, 0.86, 0.92), vec3(0.95, 0.97, 1.0), seed);
  if (material == 3) return mix(vec3(0.75, 0.04, 0.1), vec3(0.85, 0.08, 0.14), seed);
  if (material == 4) return vec3(0.015 + 0.02 * seed);
  return mix(vec3(0.8, 0.14, 0.01), vec3(0.9, 0.2, 0.02), seed);
}

void main() {
  ivec2 c = ivec2(gl_VertexID % uTexW, gl_VertexID / uTexW);
  vec4 pm = texelFetch(uPos, c, 0);
  int material = int(pm.w);
  float seed = fract(pm.w);
  vColor = vec4(sqrt(particleColor(material, seed)), (float(material) + 0.5) / 8.0);
  vParticle = vec4(pm.xyz, seed);
  // Sand is drawn as big, heavily overlapping spheres so that together they form smooth slopes
  // rather than a heap of balls.
  vRadius = uRadius * (material <= 1 ? SAND_RADIUS_SCALE : 1.0);
  vec4 viewPos = uModelView * vec4(pm.xyz, 1.0);
  vViewCenter = viewPos.xyz;
  gl_Position = uProj * viewPos;
  gl_PointSize = 2.0 * vRadius * uProjScale / max(-viewPos.z, 1e-3);
}
