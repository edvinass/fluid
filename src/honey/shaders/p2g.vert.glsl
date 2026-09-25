uniform sampler2D uPos; // xyz = world position, w = volume ratio J
uniform sampler2D uVel; // xyz = velocity (cells / s), w = C00
uniform sampler2D uC1; // C01 C02 C10 C11
uniform sampler2D uC2; // C12 C20 C21 C22
uniform int uTexW;
uniform vec2 uAtlasSize;
uniform float uDt;
uniform float uParticleMass;
uniform float uStiffness;

flat out vec4 vValue;

// Particle to grid: one point per (particle, neighbouring node) pair, with gl_InstanceID picking
// which of the 27 nodes. Additive blending sums momentum (xyz) and mass (w) at every node.
void main() {
  ivec2 t = ivec2(gl_VertexID % uTexW, gl_VertexID / uTexW);
  vec4 pj = texelFetch(uPos, t, 0);
  vec4 vc = texelFetch(uVel, t, 0);
  vec4 c1 = texelFetch(uC1, t, 0);
  vec4 c2 = texelFetch(uC2, t, 0);
  mat3 C = mat3(vc.w, c1.z, c2.y, c1.x, c1.w, c2.z, c1.y, c2.x, c2.w);

  vec3 xg = toGrid(pj.xyz);
  vec3 base = floor(xg - 0.5);
  vec3 fx = xg - base;
  vec3 w[3];
  splineWeights(fx, w);
  ivec3 o = ivec3(gl_InstanceID % 3, (gl_InstanceID / 3) % 3, gl_InstanceID / 9);
  float weight = w[o.x].x * w[o.y].y * w[o.z].z;
  vec3 dpos = vec3(o) - fx;

  // Weakly compressible pressure from the volume change. A little tension (J > 1) holds the
  // liquid together.
  float pressure = uStiffness * (1.0 - pj.w);
  float volume = uParticleMass;
  mat3 affine = mat3(4.0 * uDt * volume * pressure) + uParticleMass * C;
  vValue = vec4(weight * (uParticleMass * vc.xyz + affine * dpos), weight * uParticleMass);

  ivec3 node = ivec3(base) + o;
  gl_PointSize = 1.0;
  gl_Position = inGrid(node) ? vec4((vec2(texelOf(node)) + 0.5) / uAtlasSize * 2.0 - 1.0, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
