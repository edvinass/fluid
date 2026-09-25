uniform sampler2D uPos;
uniform sampler2D uVel; // w = temperature
uniform float uRadius;
uniform float uMaxSpeed;
uniform int uOutput; // 0 = position, 1 = velocity and temperature

out vec4 outData;

// Moves the wax and keeps it inside the glass, sliding along the walls. Both outputs run the same
// code so position and velocity stay consistent.
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec3 p = texelFetch(uPos, c, 0).xyz;
  vec4 vt = texelFetch(uVel, c, 0);
  vec3 v = vt.xyz;

  float speed = length(v);
  if (speed > uMaxSpeed) v *= uMaxSpeed / speed;
  if (any(isnan(v)) || any(isinf(v))) v = vec3(0.0);
  p += v * uDt;

  float bottom = LAMP_BOTTOM + uRadius;
  float top = LAMP_TOP - uRadius;
  if (p.y < bottom) {
    p.y = bottom;
    v.y = max(v.y, 0.0);
  } else if (p.y > top) {
    p.y = top;
    v.y = min(v.y, 0.0);
  }
  float limit = lampRadius(p.y) - uRadius;
  float r = length(p.xz);
  if (r > limit) {
    vec2 n = p.xz / max(r, 1e-6);
    p.xz = n * limit;
    float vn = dot(v.xz, n);
    if (vn > 0.0) v.xz -= n * vn;
  }
  if (any(isnan(p))) p = vec3(0.0, LAMP_BOTTOM + 0.05, 0.0);

  outData = uOutput == 0 ? vec4(p, 1.0) : vec4(v, vt.w);
}
