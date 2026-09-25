#version 300 es
precision highp float;

flat in vec4 vValue;
out vec4 outValue;

void main() {
  outValue = vValue;
}
