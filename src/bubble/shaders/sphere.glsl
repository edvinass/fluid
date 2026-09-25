#version 300 es
precision highp float;
precision highp samplerCube;

// Fields on the unit sphere stored in cube maps. Each pass renders one face at a time: uFace picks
// the face and every texel maps to a direction (a point on the sphere). Velocities are 3D vectors
// tangent to the sphere, in radians per second.
uniform int uFace;
uniform float uSize; // texels along a face edge
uniform float uTime;

vec3 faceDir(int face, vec2 st) {
  vec2 c = st * 2.0 - 1.0;
  if (face == 0) return vec3(1.0, -c.y, -c.x);
  if (face == 1) return vec3(-1.0, -c.y, c.x);
  if (face == 2) return vec3(c.x, 1.0, c.y);
  if (face == 3) return vec3(c.x, -1.0, -c.y);
  if (face == 4) return vec3(c.x, -c.y, 1.0);
  return vec3(-c.x, -c.y, -1.0);
}

vec3 texelDir(vec2 offset) {
  return normalize(faceDir(uFace, (gl_FragCoord.xy + offset) / uSize));
}

vec3 toTangent(vec3 v, vec3 n) {
  return v - n * dot(n, v);
}

// The four neighbouring texels (left, right, down, up), which may lie on an adjacent face: their
// directions q, the unit tangents t pointing towards them from p, and their angular distances a.
struct Neighbours {
  vec3 q[4];
  vec3 t[4];
  float a[4];
};

Neighbours neighbours(vec3 p) {
  const vec2 OFFSETS[4] = vec2[4](vec2(-1.0, 0.0), vec2(1.0, 0.0), vec2(0.0, -1.0), vec2(0.0, 1.0));
  Neighbours nb;
  for (int k = 0; k < 4; k++) {
    vec3 q = texelDir(OFFSETS[k]);
    nb.q[k] = q;
    nb.t[k] = normalize(q - p * dot(p, q));
    nb.a[k] = asin(clamp(length(cross(p, q)), 0.0, 1.0));
  }
  return nb;
}

// Gradient of a scalar field from its values at the four neighbours.
vec3 gradient(Neighbours nb, vec4 values) {
  return (values.y - values.x) / (nb.a[0] + nb.a[1]) * normalize(nb.t[1] - nb.t[0])
    + (values.w - values.z) / (nb.a[2] + nb.a[3]) * normalize(nb.t[3] - nb.t[2]);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
