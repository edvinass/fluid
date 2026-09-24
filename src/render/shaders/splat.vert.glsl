#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uPos;
uniform sampler2D uVel;
uniform int uTexW;
uniform mat4 uModelView;
uniform mat4 uProj;
uniform float uRadius;
uniform float uProjScale;

out vec3 vViewCenter;
out float vSpeed;

// Point sprite for particle gl_VertexID, sized to cover a sphere of radius uRadius.
void main() {
  ivec2 c = ivec2(gl_VertexID % uTexW, gl_VertexID / uTexW);
  vec3 p = texelFetch(uPos, c, 0).xyz;
  vSpeed = length(texelFetch(uVel, c, 0).xyz);
  vec4 viewPos = uModelView * vec4(p, 1.0);
  vViewCenter = viewPos.xyz;
  gl_Position = uProj * viewPos;
  gl_PointSize = 2.0 * uRadius * uProjScale / max(-viewPos.z, 1e-3);
}
