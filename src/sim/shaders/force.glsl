uniform sampler2D uPred;
uniform sampler2D uVel;
uniform sampler2D uDensity;
uniform float uTargetDensity;
uniform float uPressureK;
uniform float uNearPressureK;
uniform float uViscosity;

out vec4 outVel;

float pressureOf(float density) {
  return (density - uTargetDensity) * uPressureK;
}

// Pressure, near-pressure and viscosity forces; outputs the updated velocity.
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int i = indexOf(gl_FragCoord.xy);
  vec3 pi = texelFetch(uPred, c, 0).xyz;
  vec3 vi = texelFetch(uVel, c, 0).xyz;
  vec2 di = texelFetch(uDensity, c, 0).xy;
  float pressureI = pressureOf(di.x);
  float nearPressureI = di.y * uNearPressureK;

  ivec3 cell = cellOf(pi);
  float h2 = uH * uH;
  vec3 pressureForce = vec3(0.0);
  vec3 viscosityForce = vec3(0.0);

  for (int dz = -1; dz <= 1; dz++) {
    for (int dy = -1; dy <= 1; dy++) {
      ivec2 range = rowRange(cell, dy, dz);
      for (int j = range.x; j < range.y; j++) {
        if (j == i) continue;
        ivec2 cj = coordOf(j);
        vec3 offset = texelFetch(uPred, cj, 0).xyz - pi;
        float r2 = dot(offset, offset);
        if (r2 >= h2) continue;

        float r = sqrt(r2);
        // Coincident particles get a deterministic pseudo-random separation direction.
        vec3 dir = r > 1e-6
          ? offset / r
          : normalize(vec3(fract(float(i) * 0.618034) - 0.5, 0.5, fract(float(j) * 0.414214) - 0.5));
        vec2 dj = texelFetch(uDensity, cj, 0).xy;
        float q = uH - r;

        float sharedPressure = 0.5 * (pressureI + pressureOf(dj.x));
        float sharedNearPressure = 0.5 * (nearPressureI + dj.y * uNearPressureK);
        float dW = -2.0 * uSpiky2Norm * q;
        float dWNear = -3.0 * uSpiky3Norm * q * q;
        pressureForce += dir * (dW * sharedPressure / dj.x + dWNear * sharedNearPressure / dj.y);

        float w = h2 - r2;
        viscosityForce += (texelFetch(uVel, cj, 0).xyz - vi) * (w * w * w * uPoly6Norm / dj.x);
      }
    }
  }

  vec3 accel = pressureForce * uMass / di.x;
  vec3 v = vi + accel * uDt + viscosityForce * uMass * min(uViscosity * uDt, 1.0);
  outVel = vec4(v, 0.0);
}
