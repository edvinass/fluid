uniform sampler2D uPred;
uniform sampler2D uVel; // w = temperature, 0 (cold) to 1 (hot)
uniform sampler2D uDensity;
uniform float uPressureK;
uniform float uNearPressureK;
uniform float uViscosity;
uniform float uCohesion;
uniform float uCohesionNorm; // 32 / (pi h^9)
uniform float uBuoyancy;
uniform float uDrag;
uniform float uHeatDiffusion;
uniform float uHeat;
uniform float uCool;

out vec4 outVel;

// Surface tension kernel (Akinci et al. 2013): attracts neighbours at mid range, repels close ones.
float cohesionKernel(float r) {
  float a = (uH - r) * (uH - r) * (uH - r) * r * r * r;
  return uCohesionNorm * (2.0 * r > uH ? a : 2.0 * a - uH * uH * uH * uH * uH * uH / 64.0);
}

// Wax forces and heat: pressure keeps the wax from compressing, cohesion pulls it into round blobs,
// and buoyancy lifts warm wax and sinks cool wax through the liquid, which drags on it. Heat
// spreads between neighbours, comes from the bulb at the bottom and leaks away higher up.
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int i = indexOf(gl_FragCoord.xy);
  vec3 pi = texelFetch(uPred, c, 0).xyz;
  vec4 vt = texelFetch(uVel, c, 0);
  vec3 vi = vt.xyz;
  float ti = vt.w;
  vec2 di = texelFetch(uDensity, c, 0).xy;
  // No negative pressure: cohesion does the attracting, and a half-empty neighbourhood at the glass
  // would otherwise suck wall particles inwards violently.
  float pressureI = max(di.x - 1.0, 0.0);
  float nearPressureI = max(di.y - 1.0, 0.0) * uNearPressureK;

  ivec3 cell = cellOf(pi);
  float h2 = uH * uH;
  vec3 pressureForce = vec3(0.0);
  vec3 viscosityForce = vec3(0.0);
  vec3 cohesionForce = vec3(0.0);
  float heatFlow = 0.0;
  float weightSum = 0.0;
  float tempSum = 0.0;

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
        vec3 dir = r > 1e-6
          ? offset / r
          : normalize(vec3(fract(float(i) * 0.618034) - 0.5, 0.5, fract(float(j) * 0.414214) - 0.5));
        vec2 dj = texelFetch(uDensity, cj, 0).xy;
        float q = uH - r;
        float sharedPressure = 0.5 * (pressureI + max(dj.x - 1.0, 0.0)) * uPressureK;
        float sharedNearPressure = 0.5 * (nearPressureI + max(dj.y - 1.0, 0.0) * uNearPressureK);
        float dW = -2.0 * uSpiky2Norm * q;
        float dWNear = -3.0 * uSpiky3Norm * q * q;
        pressureForce += dir * (dW * sharedPressure / dj.x + dWNear * sharedNearPressure / dj.y);

        cohesionForce += dir * cohesionKernel(r);

        float w = h2 - r2;
        float weight = w * w * w * uPoly6Norm / dj.x;
        vec4 vtj = texelFetch(uVel, cj, 0);
        viscosityForce += (vtj.xyz - vi) * weight;
        heatFlow += (vtj.w - ti) * weight;
        weightSum += weight;
        tempSum += vtj.w * weight;
      }
    }
  }

  // Buoyancy from the neighbourhood's temperature rather than the particle's own, so wax rises and
  // sinks in coherent blobs instead of hot particles escaping one by one.
  float selfWeight = uH * uH * uH * uH * uH * uH * uPoly6Norm / di.x;
  float smoothT = (tempSum + ti * selfWeight) / (weightSum + selfWeight);
  vec3 accel = pressureForce * uMass / di.x + cohesionForce * uCohesion * uMass;
  accel.y += uBuoyancy * (smoothT - 0.5);
  vec3 v = vi + accel * uDt + viscosityForce * uMass * min(uViscosity * uDt, 1.0);
  v *= exp(-uDrag * uDt);

  float t = ti + heatFlow * uMass * min(uHeatDiffusion * uDt, 1.0);
  float height = clamp((pi.y - LAMP_BOTTOM) / (LAMP_TOP - LAMP_BOTTOM), 0.0, 1.0);
  float nearBulb = 1.0 - smoothstep(0.0, 0.08, pi.y - LAMP_BOTTOM);
  float centre = 1.0 - smoothstep(0.0, lampRadius(pi.y), length(pi.xz)) * 0.6;
  t += uHeat * nearBulb * centre * (1.0 - t) * uDt;
  // The liquid is cooler than the wax's neutral temperature (0.5) everywhere, so wax that leaves the
  // bulb eventually sinks again.
  t += uCool * (mix(0.4, 0.1, height) - t) * uDt;
  outVel = vec4(v, clamp(t, 0.0, 1.0));
}
