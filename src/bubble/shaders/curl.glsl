uniform samplerCube uVel;

out vec4 outCurl;

// Vorticity: the curl of the film velocity about the outward normal.
void main() {
  vec3 p = texelDir(vec2(0.0));
  Neighbours nb = neighbours(p);
  vec3 ex = normalize(nb.t[1] - nb.t[0]);
  vec3 ey = normalize(nb.t[3] - nb.t[2]);
  // Faces differ in handedness; flip so that ex x ey points outwards.
  float s = dot(cross(ex, ey), p) < 0.0 ? -1.0 : 1.0;
  vec3 vl = texture(uVel, nb.q[0]).xyz;
  vec3 vr = texture(uVel, nb.q[1]).xyz;
  vec3 vd = texture(uVel, nb.q[2]).xyz;
  vec3 vu = texture(uVel, nb.q[3]).xyz;
  float dvydx = s * dot(vr - vl, ey) / (nb.a[0] + nb.a[1]);
  float dvxdy = s * dot(vu - vd, ex) / (nb.a[2] + nb.a[3]);
  outCurl = vec4(dvydx - dvxdy, 0.0, 0.0, 1.0);
}
