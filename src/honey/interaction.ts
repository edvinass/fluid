import { MOUSE, Plane, Raycaster, TOUCH, Vector2, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Pointer handling for the honey page: press (and drag) to act, orbit with the right button, Ctrl +
 * drag or two fingers. What pressing does depends on the scene, so this only reports where the
 * pointer is.
 */
export class HoneyInteraction {
  readonly controls: OrbitControls;
  /** Seconds since the user last pressed. */
  idleTime = 0;
  pressing = false;
  /** Called when a press starts. */
  onPress: () => void = () => {};

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private pointerId = -1;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 5;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.08;
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    this.controls.touches = { ONE: null as unknown as TOUCH, TWO: TOUCH.DOLLY_ROTATE };

    canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  update(dt: number): void {
    this.controls.update(dt);
    if (this.pressing) this.idleTime = 0;
    else this.idleTime += dt;
  }

  /** Where the pointer ray meets the horizontal plane at height `y`, if it does. */
  horizontalPoint(y: number): Vector3 | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -y), new Vector3());
  }

  /** Where the pointer ray meets the upright, camera-facing plane through `p`. */
  uprightPoint(p: Vector3): Vector3 {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const normal = new Vector3();
    this.camera.getWorldDirection(normal);
    normal.y = 0;
    if (normal.lengthSq() < 1e-6) normal.set(0, 0, -1);
    normal.normalize();
    return this.raycaster.ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(normal, p), new Vector3()) ?? p.clone();
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (!e.isPrimary) {
        this.endPress();
        return;
      }
    } else if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || this.pressing) {
      this.controls.enabled = true;
      return;
    }
    if (e.pointerType !== 'touch') {
      this.controls.enabled = false;
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
    this.pressing = true;
    this.pointerId = e.pointerId;
    this.setPointer(e);
    this.onPress();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId === this.pointerId) this.setPointer(e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.endPress();
  };

  private endPress(): void {
    this.pressing = false;
    this.pointerId = -1;
    this.controls.enabled = true;
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }
}
