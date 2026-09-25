uniform sampler2D uState;

out vec4 outLight;

// Per-cell glow weighted by position. Summed down to one texel, this gives the fire's overall
// brightness and its centre of light, used to light the ground, the scenery and the smoke.
void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c)) {
    outLight = vec4(0.0);
    return;
  }
  float t = max(fetch(uState, c).r - 0.2, 0.0);
  float glow = t * t;
  vec3 world = (vec3(c) + 0.5) * uCellSize - uBoxHalf;
  outLight = vec4(world * glow, glow);
}
