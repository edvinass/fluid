import { MOUSE, Raycaster, TOUCH, Vector2, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLASS_RADIUS, type Touch, type Vec3 } from './PlasmaSimulator';

/**
 * Pointer handling for the plasma globe: press on the glass to touch it (with as many fingers as you
 * like), and drag beside it, or with the right button, to orbit.
 */
export class PlasmaInteraction {
  readonly controls: OrbitControls;

  private readonly raycaster = new Raycaster();
  private readonly pointers = new Map<number, Vector2>();
  private readonly touchPoints = new Map<number, Vector3>();
  private readonly orbitPointers = new Set<number>();

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 10;
    this.controls.maxPolarAngle = 1.72;
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    this.controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE };

    canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  update(dt: number): void {
    this.controls.update(dt);
    for (const [id, ndc] of this.pointers) this.touchPoints.set(id, this.hit(ndc, true)!);
  }

  touches(): Touch[] {
    return [...this.touchPoints].map(([id, p]) => ({ id, point: p.toArray() as Vec3 }));
  }

  private onPointerDown = (e: PointerEvent): void => {
    const ndc = this.toNdc(e);
    // Once the camera is orbiting, further fingers pinch and rotate rather than touch the globe.
    const orbit = e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || this.orbitPointers.size > 0 || !this.hit(ndc, false);
    if (orbit) {
      if (!this.pointers.size) this.orbitPointers.add(e.pointerId);
      return;
    }
    this.controls.enabled = false;
    this.pointers.set(e.pointerId, ndc);
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (p) p.copy(this.toNdc(e));
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.orbitPointers.delete(e.pointerId);
    if (!this.pointers.delete(e.pointerId)) return;
    this.touchPoints.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!this.pointers.size) this.controls.enabled = true;
  };

  private toNdc(e: MouseEvent): Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  /**
   * The unit direction of the point under the cursor on the near side of the glass. When the cursor
   * misses and `nearest` is set, the point on the globe closest to the ray instead, so a finger
   * dragged off the edge stays on the glass.
   */
  private hit(ndc: Vector2, nearest: boolean): Vector3 | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const b = origin.dot(direction);
    const h = b * b - origin.lengthSq() + GLASS_RADIUS * GLASS_RADIUS;
    const p = origin.clone();
    if (h >= 0) return p.addScaledVector(direction, -b - Math.sqrt(h)).normalize();
    if (!nearest) return null;
    return p.addScaledVector(direction, -b).normalize();
  }
}
