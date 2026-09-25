uniform sampler2D uVel;

out vec4 outCurl;

void main() {
  ivec3 c = cellFromFrag(gl_FragCoord.xy);
  if (!inGrid(c)) {
    outCurl = vec4(0.0);
    return;
  }
  vec3 l = fetch(uVel, c - ivec3(1, 0, 0)).xyz;
  vec3 r = fetch(uVel, c + ivec3(1, 0, 0)).xyz;
  vec3 b = fetch(uVel, c - ivec3(0, 1, 0)).xyz;
  vec3 t = fetch(uVel, c + ivec3(0, 1, 0)).xyz;
  vec3 d = fetch(uVel, c - ivec3(0, 0, 1)).xyz;
  vec3 u = fetch(uVel, c + ivec3(0, 0, 1)).xyz;
  vec3 w = 0.5 * vec3((t.z - b.z) - (u.y - d.y), (u.x - d.x) - (r.z - l.z), (r.y - l.y) - (t.x - b.x));
  outCurl = vec4(w, length(w));
}
