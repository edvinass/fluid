import { MOUSE, Raycaster, TOUCH, Vector2, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ObjectSettings, Obstacle, Vec3 } from './obstacle';
import type { Wand } from './WindSimulator';

type Action = 'drag' | 'smoke';

const WAND_RADIUS = 0.025;

/**
 * Pointer handling for the wind tunnel: drag the object to move it, press anywhere else to hold a
 * smoke wand there, and orbit with the right button (or Ctrl + drag, or two fingers on touch).
 */
export class WindInteraction {
  readonly controls: OrbitControls;

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly grabOffset = new Vector3();
  private readonly grabAnchor = new Vector3();
  private action: Action | null = null;
  private pointerId = -1;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly tunnelHalf: Vec3,
    private readonly obstacle: Obstacle,
    private readonly objectSettings: ObjectSettings,
  ) {
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 9;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    // One finger drags or makes smoke; OrbitControls still tracks it so a second finger can pinch or rotate.
    this.controls.touches = { ONE: null as unknown as TOUCH, TWO: TOUCH.DOLLY_ROTATE };

    canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  update(dt: number): void {
    this.controls.update(dt);
    if (this.action === 'drag') {
      this.obstacle.moveTo(this.planePoint(this.grabAnchor).add(this.grabOffset), this.objectSettings);
    }
  }

  /** The smoke wand while the user holds it. */
  wand(): Wand | null {
    if (this.action !== 'smoke') return null;
    const [hx, hy, hz] = this.tunnelHalf;
    const p = this.planePoint(this.obstacle.position);
    const m = WAND_RADIUS * 2;
    return {
      position: [
        Math.max(-hx + m, Math.min(hx - m, p.x)),
        Math.max(-hy + m, Math.min(hy - m, p.y)),
        Math.max(-hz + m, Math.min(hz - m, p.z)),
      ],
      radius: WAND_RADIUS,
    };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (!e.isPrimary) {
        this.endAction();
        return;
      }
      this.beginAction(e);
      return;
    }
    const orbit = e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey;
    if (orbit || this.action) {
      this.controls.enabled = true;
      return;
    }
    this.controls.enabled = false;
    this.beginAction(e);
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private beginAction(e: PointerEvent): void {
    this.pointerId = e.pointerId;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.obstacle.pick(this.raycaster.ray) !== null) {
      this.action = 'drag';
      this.grabAnchor.copy(this.obstacle.position);
      this.grabOffset.copy(this.obstacle.position).sub(this.planePoint(this.grabAnchor));
      this.canvas.style.cursor = 'grabbing';
    } else {
      this.action = 'smoke';
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId === this.pointerId) {
      this.setPointer(e);
      return;
    }
    if (this.action || e.pointerType !== 'mouse') return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.canvas.style.cursor = this.obstacle.pick(this.raycaster.ray) !== null ? 'grab' : '';
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.endAction();
  };

  private endAction(): void {
    if (this.action === 'drag') this.canvas.style.cursor = 'grab';
    this.action = null;
    this.pointerId = -1;
    this.controls.enabled = true;
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  /** Where the cursor ray meets the camera-facing plane through `anchor`. */
  private planePoint(anchor: Vector3): Vector3 {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const normal = new Vector3();
    this.camera.getWorldDirection(normal);
    const t = anchor.clone().sub(origin).dot(normal) / direction.dot(normal);
    return origin.clone().addScaledVector(direction, t);
  }
}
