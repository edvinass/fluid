type UniformValue = number | boolean | ArrayLike<number>;

interface UniformInfo {
  location: WebGLUniformLocation;
  type: GLenum;
  unit: number;
}

const SAMPLER_TYPES = new Set<GLenum>([
  WebGL2RenderingContext.SAMPLER_2D,
  WebGL2RenderingContext.INT_SAMPLER_2D,
  WebGL2RenderingContext.UNSIGNED_INT_SAMPLER_2D,
  WebGL2RenderingContext.SAMPLER_CUBE,
]);

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string, name: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    const numbered = source
      .split('\n')
      .map((line, i) => `${String(i + 1).padStart(4)}: ${line}`)
      .join('\n');
    gl.deleteShader(shader);
    throw new Error(`Failed to compile ${name} (${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'}):\n${log}\n${numbered}`);
  }
  return shader;
}

export class Program {
  readonly program: WebGLProgram;
  private readonly uniforms = new Map<string, UniformInfo>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
    readonly name = 'program',
  ) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertexSource, name);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, name);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Failed to link ${name}:\n${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;

    gl.useProgram(program);
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    let unit = 0;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const location = gl.getUniformLocation(program, info.name);
      if (!location) continue;
      const uniformName = info.name.replace(/\[0\]$/, '');
      const isSampler = SAMPLER_TYPES.has(info.type);
      this.uniforms.set(uniformName, { location, type: info.type, unit: isSampler ? unit : -1 });
      if (isSampler) gl.uniform1i(location, unit++);
    }
  }

  use(): this {
    this.gl.useProgram(this.program);
    return this;
  }

  /** Sets a uniform on the currently bound program. Unknown names are ignored (they may be optimised out). */
  set(name: string, value: UniformValue): this {
    const u = this.uniforms.get(name);
    if (!u) return this;
    const gl = this.gl;
    const v = value as ArrayLike<number> & Float32List & Int32List;
    switch (u.type) {
      case gl.FLOAT:
        if (typeof value === 'number') gl.uniform1f(u.location, value);
        else gl.uniform1fv(u.location, v);
        break;
      case gl.FLOAT_VEC2:
        gl.uniform2fv(u.location, v);
        break;
      case gl.FLOAT_VEC3:
        gl.uniform3fv(u.location, v);
        break;
      case gl.FLOAT_VEC4:
        gl.uniform4fv(u.location, v);
        break;
      case gl.INT:
      case gl.BOOL:
        gl.uniform1i(u.location, Number(value));
        break;
      case gl.INT_VEC2:
        gl.uniform2iv(u.location, v);
        break;
      case gl.INT_VEC3:
        gl.uniform3iv(u.location, v);
        break;
      case gl.FLOAT_MAT3:
        gl.uniformMatrix3fv(u.location, false, v);
        break;
      case gl.FLOAT_MAT4:
        gl.uniformMatrix4fv(u.location, false, v);
        break;
      default:
        throw new Error(`${this.name}: unsupported uniform type for ${name}`);
    }
    return this;
  }

  /** Binds a texture to the sampler uniform's reserved texture unit. */
  texture(name: string, texture: WebGLTexture): this {
    const u = this.uniforms.get(name);
    if (!u || u.unit < 0) return this;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + u.unit);
    gl.bindTexture(u.type === gl.SAMPLER_CUBE ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D, texture);
    return this;
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}
