// The lamp, in world units: a glass vessel that is narrow at the bottom, widest a little above
// it and tapers towards the cap, on a metal cone base. Shared by the solver and the renderer.
const float LAMP_BOTTOM = -0.62;
const float LAMP_WAIST = -0.25;
const float LAMP_TOP = 0.62;
const float R_BOTTOM = 0.17;
const float R_WAIST = 0.25;
const float R_TOP = 0.12;
const float GLASS = 0.012;
const float TABLE_Y = -1.05;
const float BASE_R = 0.3;
const float CAP_TOP = 0.92;
const float CAP_R = 0.07;

/** Inner radius of the glass at height y. */
float lampRadius(float y) {
  return y < LAMP_WAIST
    ? mix(R_BOTTOM, R_WAIST, clamp((y - LAMP_BOTTOM) / (LAMP_WAIST - LAMP_BOTTOM), 0.0, 1.0))
    : mix(R_WAIST, R_TOP, clamp((y - LAMP_WAIST) / (LAMP_TOP - LAMP_WAIST), 0.0, 1.0));
}

/** Signed distance (roughly) to the inside of the glass grown by `grow`. */
float vesselSDF(vec3 p, float grow) {
  float radial = (length(p.xz) - lampRadius(p.y) - grow) * 0.97;
  return max(radial, max(LAMP_BOTTOM - p.y, p.y - LAMP_TOP));
}
