uniform sampler2D uPos;
uniform sampler2D uVel;

out vec4 outData;

// Writes (cell key, particle index) for the predicted position of each particle.
void main() {
  int i = indexOf(gl_FragCoord.xy);
  ivec2 c = coordOf(i);
  vec3 p = uFrameRot * texelFetch(uPos, c, 0).xyz;
  vec3 v = applyExternal(p, uFrameRot * texelFetch(uVel, c, 0).xyz);
  vec3 predicted = p + v * uDt;
  outData = vec4(float(keyOf(cellOf(predicted))), float(i), 0.0, 0.0);
}
