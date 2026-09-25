import { drawFullscreen, FULLSCREEN_VS } from '../gl/context';
import { Program } from '../gl/program';
import type { ViewState } from '../render/camera';
import type { Vec3 } from './BubbleSimulator';
import sphereSrc from './shaders/sphere.glsl?raw';
import bubbleFs from './shaders/bubble.frag.glsl?raw';

export type Environment = 'Studio' | 'Daylight';

export interface BubbleView {
  center: Vec3;
  /** Current radius; 0 when there's no bubble. */
  radius: number;
  /** Where it burst, or null while intact. */
  popPoint: Vec3 | null;
  /** Angular radius of the burst hole, radians. */
  popRadius: number;
}

export interface BubbleLook {
  environment: Environment;
  exposure: number;
  /** Refractive index of the soapy water. */
  filmIndex: number;
}

/** Ray traces the bubble and its surroundings in a single pass. */
export class BubbleRenderer {
  private readonly program: Program;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = new Program(gl, FULLSCREEN_VS, sphereSrc + bubbleFs, 'bubble');
  }

  render(view: ViewState, film: WebGLTexture, bubble: BubbleView, look: BubbleLook, time: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.width, view.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const pop = bubble.popPoint ? [...bubble.popPoint, bubble.popRadius] : [0, 1, 0, -1];
    this.program
      .use()
      .set('uCameraWorld', view.cameraWorld)
      .set('uTanHalfFov', view.tanHalfFov)
      .set('uAspect', view.aspect)
      .set('uCenter', bubble.center)
      .set('uRadius', bubble.radius)
      .set('uPop', pop)
      .set('uEnv', look.environment === 'Studio' ? 0 : 1)
      .set('uExposure', look.exposure)
      .set('uFilmIndex', look.filmIndex)
      .set('uTime', time)
      .texture('uFilm', film);
    drawFullscreen(gl);
  }
}
