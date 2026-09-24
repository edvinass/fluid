uniform sampler2D uPred;

out vec4 outDensity;

// Density (spiky^2 kernel) and near-density (spiky^3 kernel) at each predicted position.
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec3 pi = texelFetch(uPred, c, 0).xyz;
  ivec3 cell = cellOf(pi);
  float h2 = uH * uH;
  float density = 0.0;
  float nearDensity = 0.0;

  for (int dz = -1; dz <= 1; dz++) {
    for (int dy = -1; dy <= 1; dy++) {
      ivec2 range = rowRange(cell, dy, dz);
      for (int j = range.x; j < range.y; j++) {
        vec3 d = texelFetch(uPred, coordOf(j), 0).xyz - pi;
        float r2 = dot(d, d);
        if (r2 < h2) {
          float q = uH - sqrt(r2);
          float q2 = q * q;
          density += q2;
          nearDensity += q2 * q;
        }
      }
    }
  }

  outDensity = vec4(density * uMass * uSpiky2Norm, nearDensity * uMass * uSpiky3Norm, 0.0, 0.0);
}
