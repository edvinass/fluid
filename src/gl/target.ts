export interface TextureFormat {
  internalFormat: GLenum;
  format: GLenum;
  type: GLenum;
  filter?: GLenum;
}

export function rgba32f(gl: WebGL2RenderingContext): TextureFormat {
  return { internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST };
}

export function rg32f(gl: WebGL2RenderingContext): TextureFormat {
  return { internalFormat: gl.RG32F, format: gl.RG, type: gl.FLOAT, filter: gl.NEAREST };
}

export function r32f(gl: WebGL2RenderingContext): TextureFormat {
  return { internalFormat: gl.R32F, format: gl.RED, type: gl.FLOAT, filter: gl.NEAREST };
}

export function r16f(gl: WebGL2RenderingContext): TextureFormat {
  return { internalFormat: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT, filter: gl.LINEAR };
}

export function rgba16f(gl: WebGL2RenderingContext): TextureFormat {
  return { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR };
}

export function rgba8(gl: WebGL2RenderingContext): TextureFormat {
  return { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR };
}

/** A texture with a framebuffer attached, optionally with a depth renderbuffer. */
export class RenderTarget {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  private depth: WebGLRenderbuffer | null = null;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly width: number,
    readonly height: number,
    readonly format: TextureFormat,
    withDepth = false,
    data: ArrayBufferView | null = null,
  ) {
    const filter = format.filter ?? gl.NEAREST;
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, format.internalFormat, width, height, 0, format.format, format.type, data);

    this.framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    if (withDepth) {
      this.depth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    }
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer incomplete (0x${status.toString(16)})`);
    }
  }

  bind(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
  }

  upload(data: ArrayBufferView): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.format.format, this.format.type, data);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteFramebuffer(this.framebuffer);
    if (this.depth) gl.deleteRenderbuffer(this.depth);
  }
}

/** Two render targets that alternate between being read from and written to. */
export class PingPong {
  read: RenderTarget;
  write: RenderTarget;

  constructor(gl: WebGL2RenderingContext, width: number, height: number, format: TextureFormat, data: ArrayBufferView | null = null) {
    this.read = new RenderTarget(gl, width, height, format, false, data);
    this.write = new RenderTarget(gl, width, height, format, false, null);
  }

  swap(): void {
    const t = this.read;
    this.read = this.write;
    this.write = t;
  }

  dispose(): void {
    this.read.dispose();
    this.write.dispose();
  }
}
