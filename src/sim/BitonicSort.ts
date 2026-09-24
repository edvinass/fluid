import { drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import type { PingPong } from '../gl/target';
import commonSrc from './shaders/common.glsl?raw';
import bitonicSrc from './shaders/bitonic.glsl?raw';

/**
 * Sorts (key, index) pairs stored in the .xy channels of a ping-pong texture, entirely on the GPU.
 * The element count must be a power of two. Runs log2(n) * (log2(n) + 1) / 2 passes.
 */
export class BitonicSort {
  private readonly program: Program;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = new Program(gl, FULLSCREEN_VS, commonSrc + bitonicSrc, 'bitonic');
  }

  sort(data: PingPong, count: number): void {
    if ((count & (count - 1)) !== 0) throw new Error('BitonicSort requires a power-of-two count');
    const p = this.program.use();
    for (let block = 2; block <= count; block <<= 1) {
      for (let stride = block >> 1; stride > 0; stride >>= 1) {
        data.write.bind();
        p.texture('uData', data.read.texture);
        p.set('uBlock', block);
        p.set('uStride', stride);
        drawFullscreen(this.gl);
        data.swap();
      }
    }
  }

  dispose(): void {
    this.program.dispose();
  }
}
