import { MOUSE, Raycaster, TOUCH, Vector2, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Emitter, Vec3 } from './FireSimulator';

type Action = 'torch' | 'blow';

/** A quick click still burns for at least this long, so it leaves a visible puff of flame. */
const MIN_TORCH_SECONDS = 0.3;
const TORCH_RADIUS = 0.05;
const BLOW_RADIUS = 0.16;
const MAX_POINTER_SPEED = 5;

/**
 * Pointer handling for the fire page: hold to wield a torch, Shift + drag to blow the flames, and
 * orbit with the right button (or Ctrl + drag, or two fingers on touch).
 */
export class FireInteraction {
  readonly controls: OrbitControls;
  /** Seconds since the user last used the torch or blew. */
  idleTime = 0;

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly anchor = new Vector3();
  private action: Action | null = null;
  private pointerId = -1;
  private nowSeconds = 0;
  private torchStarted = 0;
  private torchUntil = -1;
  private prevPoint: Vector3 | null = null;
  private readonly pointerVelocity = new Vector3();
  private lastTorch: Vec3 = [0, 0, 0];

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly boxHalf: Vec3,
  ) {
    this.anchor.set(0, -boxHalf[1] + 0.5, 0);
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.6;
    this.controls.maxDistance = 8;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    // One finger wields the torch; OrbitControls still tracks it so a second finger can pinch or rotate.
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

  /** The user's torch or breath as emitters. */
  emitters(): Emitter[] {
    const v = this.pointerVelocity;
    if (this.action === 'torch' || this.nowSeconds < this.torchUntil) {
      const pos = this.action === 'torch' ? this.torchPosition() : this.lastTorch;
      this.lastTorch = pos;
      return [
        {
          shape: 'ellipsoid',
          position: pos,
          size: [TORCH_RADIUS, TORCH_RADIUS, TORCH_RADIUS],
          velocity: [v.x * 0.5, 0.3 + v.y * 0.5, v.z * 0.5],
          push: 0.5,
          fuel: 30,
          heat: 8,
          smoke: 0.3,
          flicker: 0.4,
        },
      ];
    }
    if (this.action === 'blow') {
      const p = this.planePoint();
      return [
        {
          shape: 'ellipsoid',
          position: [p.x, p.y, p.z],
          size: [BLOW_RADIUS, BLOW_RADIUS, BLOW_RADIUS],
          velocity: [v.x, v.y, v.z],
          push: 0.6,
          fuel: 0,
          heat: 0,
          smoke: 0,
          flicker: 0,
        },
      ];
    }
    return [];
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (!e.isPrimary) {
        this.endAction();
        return;
      }
      this.beginAction('torch', e);
      return;
    }
    const orbit = e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey;
    if (orbit || this.action) {
      this.controls.enabled = true;
      return;
    }
    this.controls.enabled = false;
    this.beginAction(e.shiftKey ? 'blow' : 'torch', e);
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private beginAction(action: Action, e: PointerEvent): void {
    this.action = action;
    this.pointerId = e.pointerId;
    this.torchStarted = this.nowSeconds;
    this.torchUntil = -1;
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
    if (this.action === 'torch') this.torchUntil = this.torchStarted + MIN_TORCH_SECONDS;
    this.action = null;
    this.pointerId = -1;
    this.controls.enabled = true;
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  /** Where the cursor ray meets the camera-facing plane through the lower middle of the box. */
  private planePoint(): Vector3 {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const normal = new Vector3();
    this.camera.getWorldDirection(normal);
    const t = this.anchor.clone().sub(origin).dot(normal) / direction.dot(normal);
    return origin.clone().addScaledVector(direction, t);
  }

  private torchPosition(): Vec3 {
    const [hx, hy, hz] = this.boxHalf;
    const p = this.planePoint();
    const m = TORCH_RADIUS * 3;
    return [
      Math.max(-hx + m, Math.min(hx - m, p.x)),
      Math.max(-hy + m, Math.min(hy - 0.4, p.y)),
      Math.max(-hz + m, Math.min(hz - m, p.z)),
    ];
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
