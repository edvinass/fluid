uniform sampler2D uPos;
uniform sampler2D uVel;
uniform vec3 uBoxHalf;
uniform float uRadius;
uniform float uRestitution;
uniform float uMaxSpeed;
uniform int uOutput; // 0 = position, 1 = velocity

out vec4 outData;

// Advances positions and resolves collisions with the container walls. Both outputs run the
// same deterministic code so position and velocity stay consistent.
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec3 p = texelFetch(uPos, c, 0).xyz;
  vec3 v = texelFetch(uVel, c, 0).xyz;

  float speed = length(v);
  if (speed > uMaxSpeed) v *= uMaxSpeed / speed;
  if (any(isnan(v)) || any(isinf(v))) v = vec3(0.0);

  p += v * uDt;

  vec3 limit = uBoxHalf - uRadius;
  for (int a = 0; a < 3; a++) {
    if (abs(p[a]) > limit[a]) {
      p[a] = sign(p[a]) * limit[a];
      if (v[a] * p[a] > 0.0) v[a] *= -uRestitution;
    }
  }
  if (any(isnan(p))) p = vec3(0.0);

  outData = uOutput == 0 ? vec4(p, 1.0) : vec4(v, 0.0);
}
