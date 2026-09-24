uniform sampler2D uData;
uniform int uBlock; // size of the bitonic sequence being merged (k)
uniform int uStride; // compare distance within this pass (j)

out vec4 outData;

// One compare-and-swap step of a bitonic sort on (key, index) pairs.
void main() {
  int i = indexOf(gl_FragCoord.xy);
  int partner = i ^ uStride;
  vec4 a = texelFetch(uData, coordOf(i), 0);
  vec4 b = texelFetch(uData, coordOf(partner), 0);
  bool ascending = (i & uBlock) == 0;
  bool aLess = a.x < b.x || (a.x == b.x && a.y < b.y);
  bool takeMin = (i < partner) == ascending;
  outData = (takeMin == aLess) ? a : b;
}
