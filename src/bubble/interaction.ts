import { MOUSE, Raycaster, TOUCH, Vector2, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Stir, Vec3 } from './BubbleSimulator';

const STIR_RADIUS = 0.2;
/** Radians per second. */
const MAX_STIR_SPEED = 6;

export interface BubbleShape {
  center: Vector3;
  radius: number;
}

/**
 * Pointer handling for the bubble page: drag across the bubble to stir its film, drag beside it (or
 * with the right button) to orbit, and double-click to pop it.
 */
export class BubbleInteraction {
  readonly controls: OrbitControls;

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private stirring = false;
  private pointerId = -1;
  private prevPoint: Vector3 | null = null;
  private readonly point = new Vector3();
  private readonly velocity = new Vector3();

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly bubble: () => BubbleShape,
    onPop: (point: Vec3) => void,
  ) {
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = 8;
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    this.controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE };

    canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('dblclick', (e) => {
      this.setPointer(e);
      const hit = this.hit(false);
      if (hit) onPop([hit.x, hit.y, hit.z]);
    });
  }

  update(dt: number): void {
    this.controls.update(dt);
    if (!this.stirring || dt <= 0) {
      this.velocity.multiplyScalar(0.8);
      return;
    }
    const p = this.hit(true)!;
    this.point.copy(p);
    if (this.prevPoint) {
      const v = p.clone().sub(this.prevPoint).divideScalar(dt);
      if (v.length() > MAX_STIR_SPEED) v.setLength(MAX_STIR_SPEED);
      this.velocity.lerp(v, 0.5);
    }
    this.prevPoint = p;
  }

  stirs(): Stir[] {
    if (!this.stirring) return [];
    return [{ point: this.point.toArray() as Vec3, radius: STIR_RADIUS, velocity: this.velocity.toArray() as Vec3 }];
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' && !e.isPrimary) {
      this.endStir();
      return;
    }
    const orbit = e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey;
    this.setPointer(e);
    if (orbit || this.stirring || !this.hit(false)) {
      this.controls.enabled = true;
      return;
    }
    this.controls.enabled = false;
    this.stirring = true;
    this.pointerId = e.pointerId;
    this.prevPoint = null;
    this.velocity.set(0, 0, 0);
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId === this.pointerId) this.setPointer(e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.endStir();
  };

  private endStir(): void {
    this.stirring = false;
    this.pointerId = -1;
    this.controls.enabled = true;
  }

  private setPointer(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  /**
   * The unit direction (from the bubble's centre) of the point under the cursor on the near side of
   * the bubble. When the cursor misses and `nearest` is set, the point on the bubble closest to the
   * ray instead, so a stir can continue past the outline.
   */
  private hit(nearest: boolean): Vector3 | null {
    const { center, radius } = this.bubble();
    if (radius <= 0) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const oc = origin.clone().sub(center);
    const b = oc.dot(direction);
    const h = b * b - oc.lengthSq() + radius * radius;
    if (h >= 0) return oc.addScaledVector(direction, -b - Math.sqrt(h)).normalize();
    if (!nearest) return null;
    return oc.addScaledVector(direction, -b).normalize();
  }
}
