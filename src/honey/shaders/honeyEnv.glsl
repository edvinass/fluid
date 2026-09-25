// A warm kitchen: a big window to the left, a ceiling lamp and dim walls.
const vec3 KEY_DIR = normalize(vec3(-0.55, 0.75, 0.35));
const vec3 KEY_COLOR = vec3(1.0, 0.93, 0.82) * 2.6;

vec3 environment(vec3 d) {
  vec3 wall = mix(vec3(0.16, 0.12, 0.09), vec3(0.3, 0.26, 0.22), smoothstep(-0.2, 0.6, d.y));
  vec3 col = d.y < 0.0 ? mix(vec3(0.16, 0.12, 0.09), vec3(0.08, 0.05, 0.03), smoothstep(0.0, -0.5, d.y)) : wall;
  // Window: a bright panel with mullions around the key light direction.
  vec3 f = KEY_DIR;
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f));
  vec3 u = cross(f, r);
  float z = dot(d, f);
  if (z > 0.0) {
    vec2 q = vec2(dot(d, r), dot(d, u)) / z;
    vec2 e = abs(q) - vec2(0.55, 0.4);
    float window = smoothstep(0.04, -0.04, max(e.x, e.y));
    float bars = smoothstep(0.012, 0.022, abs(q.x)) * smoothstep(0.012, 0.022, abs(q.y));
    col = mix(col, vec3(4.0, 3.9, 3.6) * (0.85 + 0.3 * q.y), window * bars);
  }
  col += vec3(1.0, 0.85, 0.6) * 3.0 * pow(max(d.y, 0.0), 40.0);
  // A soft, wide window at the back of the room, which flat pools of liquid reflect.
  vec3 b = normalize(vec3(0.15, 0.42, -1.0));
  vec3 br = normalize(cross(vec3(0.0, 1.0, 0.0), b));
  float bz = dot(d, b);
  if (bz > 0.0) {
    vec2 q = vec2(dot(d, br), dot(d, cross(b, br))) / bz;
    vec2 e = abs(q) - vec2(0.7, 0.22);
    col += vec3(2.2, 2.2, 2.1) * smoothstep(0.12, -0.12, max(e.x, e.y));
  }
  return col;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
