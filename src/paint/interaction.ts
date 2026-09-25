import { MOUSE, Raycaster, TOUCH, Vector2, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PaintSource, Vec3 } from './PaintSimulator';

export interface PourSettings {
  /** Paint added per second at the centre of the stream. */
  rate: number;
  /** Stream radius in world units. */
  width: number;
  /** Downward speed of the stream in world units per second. */
  speed: number;
  autoPour: boolean;
}

type Action = 'pour' | 'stir';

/** A quick click still pours for at least this long, so it leaves a visible drop. */
const MIN_POUR_SECONDS = 0.35;
const STIR_RADIUS = 0.14;
const MAX_POINTER_SPEED = 4;

/**
 * Pointer handling for the paint page: pour where the cursor meets the water surface, stir with
 * Shift, orbit with the right button (or Ctrl + drag, or two fingers on touch).
 */
export class PaintInteraction {
  readonly controls: OrbitControls;
  /** Seconds since the user last poured or stirred. */
  idleTime = 0;

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private action: Action | null = null;
  private pointerId = -1;
  private nowSeconds = 0;
  private pourStarted = 0;
  /** After a short click, the pour keeps going until this time. */
  private pourUntil = -1;
  private prevPoint: Vector3 | null = null;
  private readonly pointerVelocity = new Vector3();
  private lastPourPosition: Vec3 = [0, 0, 0];

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly boxHalf: Vec3,
    private readonly settings: PourSettings,
  ) {
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.4;
    this.controls.maxDistance = 9;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    // One finger pours; OrbitControls still tracks it so a second finger can pinch or rotate.
    this.controls.touches = { ONE: null as unknown as TOUCH, TWO: TOUCH.DOLLY_ROTATE };

    canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  update(dt: number, now: number): void {
    this.nowSeconds = now;
    this.controls.update(dt);
    if (this.action) this.idleTime = 0;
    else this.idleTime += dt;
    this.trackPointer(dt);
  }

  /** The user's current pour or stir as simulation sources. */
  sources(color: Vec3): PaintSource[] {
    if (this.action === 'pour' || this.nowSeconds < this.pourUntil) {
      const pos = this.action === 'pour' ? this.pourPosition() : this.lastPourPosition;
      this.lastPourPosition = pos;
      const v = this.pointerVelocity;
      return [
        {
          position: pos,
          velocity: [v.x * 0.4, -this.settings.speed, v.z * 0.4],
          color,
          amount: this.settings.rate,
          radius: this.settings.width,
          stretch: 2.5,
        },
      ];
    }
    if (this.action === 'stir') {
      const p = this.planePoint();
      const v = this.pointerVelocity;
      return [{ position: [p.x, p.y, p.z], velocity: [v.x, v.y, v.z], color, amount: 0, radius: STIR_RADIUS, stretch: 1 }];
    }
    return [];
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (!e.isPrimary) {
        this.endAction();
        return;
      }
      this.beginAction('pour', e);
      return;
    }
    const orbit = e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey;
    if (orbit || this.action) {
      this.controls.enabled = true;
      return;
    }
    this.controls.enabled = false;
    this.beginAction(e.shiftKey ? 'stir' : 'pour', e);
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private beginAction(action: Action, e: PointerEvent): void {
    this.action = action;
    this.pointerId = e.pointerId;
    this.pourStarted = this.nowSeconds;
    this.pourUntil = -1;
    this.prevPoint = null;
    this.pointerVelocity.set(0, 0, 0);
    this.setPointer(e);
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId === this.pointerId) this.setPointer(e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.endAction();
  };

  private endAction(): void {
    if (this.action === 'pour') this.pourUntil = this.pourStarted + MIN_POUR_SECONDS;
    this.action = null;
    this.pointerId = -1;
    this.controls.enabled = true;
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  /** Where the cursor ray meets the camera-facing plane through the tank centre, kept inside the tank. */
  private planePoint(): Vector3 {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const normal = new Vector3();
    this.camera.getWorldDirection(normal);
    const t = -origin.dot(normal) / direction.dot(normal);
    const p = origin.clone().addScaledVector(direction, t);
    const [hx, hy, hz] = this.boxHalf;
    return p.set(Math.max(-hx, Math.min(hx, p.x)), Math.max(-hy, Math.min(hy, p.y)), Math.max(-hz, Math.min(hz, p.z)));
  }

  /**
   * Pour point: at the water surface, directly above the point under the cursor at the tank's
   * middle depth. Clicking anywhere on the tank pours above that spot; orbit to reach other depths.
   */
  private pourPosition(): Vec3 {
    const [hx, hy, hz] = this.boxHalf;
    const p = this.planePoint();
    const margin = this.settings.width * 1.5;
    const x = Math.max(-hx + margin, Math.min(hx - margin, p.x));
    const z = Math.max(-hz + margin, Math.min(hz - margin, p.z));
    return [x, hy - 0.06, z];
  }

  private trackPointer(dt: number): void {
    if (!this.action || dt <= 0) {
      this.pointerVelocity.multiplyScalar(0.8);
      return;
    }
    const p = this.planePoint();
    if (this.prevPoint) {
      const v = p.clone().sub(this.prevPoint).divideScalar(dt);
      if (v.length() > MAX_POINTER_SPEED) v.setLength(MAX_POINTER_SPEED);
      this.pointerVelocity.lerp(v, 0.4);
    }
    this.prevPoint = p;
  }
}
