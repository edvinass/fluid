#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

// Particle and cell textures are 256 texels wide; element i sits at texel (i % 256, i / 256).
const int TEX_SHIFT = 8;
const int TEX_MASK = 255;

int indexOf(vec2 fragCoord) {
  ivec2 p = ivec2(fragCoord);
  return (p.y << TEX_SHIFT) + p.x;
}

ivec2 coordOf(int i) {
  return ivec2(i & TEX_MASK, i >> TEX_SHIFT);
}

// Uniform grid covering the container, in container-local space.
uniform vec3 uBoxMin;
uniform float uCellSize;
uniform ivec3 uGridRes;

ivec3 cellOf(vec3 p) {
  return clamp(ivec3(floor((p - uBoxMin) / uCellSize)), ivec3(0), uGridRes - 1);
}

int keyOf(ivec3 c) {
  return c.x + uGridRes.x * (c.y + uGridRes.y * c.z);
}

ivec2 cellCoord(int key) {
  return ivec2(key & TEX_MASK, key >> TEX_SHIFT);
}

// Frame-to-frame container rotation and external forces (gravity + mouse), shared by the
// key pass and the reorder pass so the predicted cell always matches the reordered data.
uniform mat3 uFrameRot;
uniform vec3 uGravity;
uniform float uDt;

uniform int uMouseMode; // 0 none, 1 stir, 2 attract/repel
uniform vec3 uRayOrigin;
uniform vec3 uRayDir;
uniform vec3 uMousePoint;
uniform vec3 uMouseVel;
uniform float uMouseRadius;
uniform float uMouseStrength;

vec3 applyExternal(vec3 p, vec3 v) {
  vec3 a = uGravity;
  if (uMouseMode == 1) {
    vec3 rel = p - uRayOrigin;
    vec3 perp = rel - uRayDir * dot(rel, uRayDir);
    float d = length(perp);
    if (d < uMouseRadius) {
      float w = 1.0 - d / uMouseRadius;
      vec3 radial = d > 1e-5 ? perp / d : vec3(0.0);
      a += (uMouseVel - v) * (10.0 * w) + radial * (uMouseStrength * 0.25 * w);
    }
  } else if (uMouseMode == 2) {
    vec3 toPoint = uMousePoint - p;
    float d = length(toPoint);
    if (d < uMouseRadius) {
      float w = 1.0 - d / uMouseRadius;
      vec3 dir = d > 1e-5 ? toPoint / d : vec3(0.0);
      a = mix(a, dir * uMouseStrength, w) - v * (w * 1.5);
    }
  }
  return v + a * uDt;
}
