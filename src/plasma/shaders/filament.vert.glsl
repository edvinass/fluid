uniform sampler2D uPaths; // per strip row, two texels per point: (position, core width), (intensity, colour)
uniform mat4 uView;
uniform mat4 uProj;
uniform vec3 uCameraPos;
uniform float uProjScale;

out float vAcross;
out float vIntensity;
out vec3 vColor;
out vec3 vWorld;

// Half the ribbon's width, in core widths. The ribbon carries the soft halo around the core.
const float HALO = 5.0;
const float MIN_CORE_PX = 1.1;

vec3 pointAt(int k, int strip) {
  return texelFetch(uPaths, ivec2(2 * k, strip), 0).xyz;
}

void main() {
  const int SEGMENTS = POINTS - 1;
  int quad = gl_VertexID / 6;
  int corner = gl_VertexID - quad * 6;
  int strip = quad / SEGMENTS;
  int seg = quad - strip * SEGMENTS;
  int along = corner == 1 || corner == 2 || corner == 4 ? 1 : 0;
  float side = corner == 2 || corner == 4 || corner == 5 ? 1.0 : -1.0;
  int k = seg + along;

  vec4 p = texelFetch(uPaths, ivec2(2 * k, strip), 0);
  vec4 q = texelFetch(uPaths, ivec2(2 * k + 1, strip), 0);
  if (q.x <= 0.0 || p.w <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  vec3 tangent = pointAt(min(k + 1, SEGMENTS), strip) - pointAt(max(k - 1, 0), strip);
  vec3 toCamera = normalize(uCameraPos - p.xyz);
  vec3 s = cross(tangent, toCamera);
  s = dot(s, s) > 1e-12 ? normalize(s) : vec3(0.0, 1.0, 0.0);

  // Keep the core at least about a pixel wide so it doesn't alias, spreading the same light wider.
  float dist = max(-(uView * vec4(p.xyz, 1.0)).z, 0.01);
  float core = p.w;
  float minCore = MIN_CORE_PX * dist / uProjScale;
  float widen = max(minCore / core, 1.0);
  core *= widen;

  vWorld = p.xyz + s * side * core * HALO;
  vAcross = side;
  vIntensity = q.x / widen;
  vColor = q.yzw;
  gl_Position = uProj * uView * vec4(vWorld, 1.0);
}
