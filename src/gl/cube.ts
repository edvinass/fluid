import type { TextureFormat } from './target';

/** A cube map texture with a framebuffer per face, for simulating fields on a sphere. */
export class CubeTarget {
  readonly texture: WebGLTexture;
  private readonly framebuffers: WebGLFramebuffer[] = [];

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly size: number,
    readonly format: TextureFormat,
  ) {
    const filter = format.filter ?? gl.NEAREST;
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.texture);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (let face = 0; face < 6; face++) {
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, 0, format.internalFormat, size, size, 0, format.format, format.type, null);
    }
    for (let face = 0; face < 6; face++) {
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, this.texture, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Cube framebuffer incomplete (0x${status.toString(16)})`);
      this.framebuffers.push(fb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bindFace(face: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[face]);
    gl.viewport(0, 0, this.size, this.size);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    for (const fb of this.framebuffers) gl.deleteFramebuffer(fb);
  }
}

export class CubePingPong {
  read: CubeTarget;
  write: CubeTarget;

  constructor(gl: WebGL2RenderingContext, size: number, format: TextureFormat) {
    this.read = new CubeTarget(gl, size, format);
    this.write = new CubeTarget(gl, size, format);
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
