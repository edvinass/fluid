import { Matrix3, Matrix4, Quaternion, Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MOUSE_ATTRACT, MOUSE_NONE, MOUSE_STIR, type MouseForce, type Vec3 } from './sim/SPHSimulator';

export type DragAction = 'orbit' | 'stir' | 'attract' | 'repel' | 'tilt';
export const DRAG_ACTIONS: DragAction[] = ['orbit', 'stir', 'attract', 'repel', 'tilt'];

export interface InteractionSettings {
  /** What a plain left drag / one-finger drag does. */
  dragAction: DragAction;
  radius: number;
  strength: number;
  deviceTilt: boolean;
}

const TILT_KEYS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  KeyW: [-1, 0],
  ArrowDown: [1, 0],
  KeyS: [1, 0],
  ArrowLeft: [0, 1],
  KeyA: [0, 1],
  ArrowRight: [0, -1],
  KeyD: [0, -1],
};

const KEY_TILT_SPEED = 1.2; // radians per second
const DRAG_TILT_SPEED = 0.006; // radians per pixel
const MAX_MOUSE_SPEED = 8;
/** Attract/repel act on a point rather than along the whole ray, so they need a larger reach. */
const ATTRACT_RADIUS_SCALE = 2.5;

/**
 * Camera orbiting, mouse forces on the fluid and tilting of the container. Everything the
 * simulation needs is exposed in container-local space.
 */
export class Interaction {
  readonly controls: OrbitControls;
  /** Current (smoothed) container rotation, local-to-world. */
  readonly boxRotation = new Quaternion();
  readonly mouse: MouseForce = {
    mode: MOUSE_NONE,
    rayOrigin: [0, 0, 0],
    rayDir: [0, 0, -1],
    point: [0, 0, 0],
    velocity: [0, 0, 0],
    radius: 0.3,
    strength: 30,
  };

  private readonly targetRotation = new Quaternion();
  private readonly appliedRotation = new Quaternion();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly keys = new Set<string>();
  private activeAction: DragAction | null = null;
  private activePointer = -1;
  private lastPointerPx = new Vector2();
  private prevPoint: Vector3 | null = null;
  private readonly smoothedVelocity = new Vector3();
  private deviceRotation: Quaternion | null = null;
  private deviceListener: ((e: DeviceOrientationEvent) => void) | null = null;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly settings: InteractionSettings,
  ) {
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 9;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.1;
    this.controls.target.set(0, 0, 0);

    canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  resetTilt(): void {
    this.targetRotation.identity();
  }

  /** Enables or disables tilting the box by tilting the device. Must be called from a user gesture on iOS. */
  async setDeviceTilt(enabled: boolean): Promise<boolean> {
    if (this.deviceListener) {
      window.removeEventListener('deviceorientation', this.deviceListener);
      this.deviceListener = null;
      this.deviceRotation = null;
    }
    if (!enabled) return false;
    const DOE = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    let baseBeta: number | null = null;
    this.deviceListener = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      if (baseBeta === null) baseBeta = e.beta;
      const clamp = (v: number) => Math.max(-60, Math.min(60, v));
      const pitch = (clamp(e.beta - baseBeta) * Math.PI) / 180;
      const roll = (clamp(e.gamma) * Math.PI) / 180;
      this.deviceRotation = this.cameraAlignedRotation(pitch, -roll);
    };
    window.addEventListener('deviceorientation', this.deviceListener);
    return true;
  }

  /** Advances tilt smoothing and recomputes the mouse force for this frame. */
  update(dt: number): void {
    let pitch = 0;
    let roll = 0;
    for (const code of this.keys) {
      const k = TILT_KEYS[code];
      if (k) {
        pitch += k[0];
        roll += k[1];
      }
    }
    if (pitch || roll) this.tiltBy(pitch * KEY_TILT_SPEED * dt, roll * KEY_TILT_SPEED * dt);

    const target = this.settings.deviceTilt && this.deviceRotation ? this.deviceRotation : this.targetRotation;
    this.boxRotation.slerp(target, 1 - Math.exp(-dt * 8));

    this.controls.update(dt);
    this.updateMouse(dt);
  }

  /**
   * Returns the rotation that maps last frame's local coordinates to this frame's, so the
   * water keeps its world-space position and velocity while the container turns under it.
   */
  consumeFrameRotation(): Float32Array {
    const inv = this.boxRotation.clone().invert();
    const delta = inv.multiply(this.appliedRotation);
    this.appliedRotation.copy(this.boxRotation);
    const m3 = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(delta));
    return new Float32Array(m3.elements);
  }

  /** Gravity direction (world down) expressed in container-local space. */
  gravityDir(): Vec3 {
    const g = new Vector3(0, -1, 0).applyQuaternion(this.boxRotation.clone().invert());
    return [g.x, g.y, g.z];
  }

  /** Skips any pending frame rotation, e.g. after a reset. */
  syncAppliedRotation(): void {
    this.appliedRotation.copy(this.boxRotation);
  }

  private cameraAlignedRotation(pitch: number, roll: number): Quaternion {
    const forward = new Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const qPitch = new Quaternion().setFromAxisAngle(right, pitch);
    const qRoll = new Quaternion().setFromAxisAngle(forward, -roll);
    return qRoll.multiply(qPitch);
  }

  private tiltBy(pitch: number, roll: number): void {
    const q = this.cameraAlignedRotation(pitch, roll);
    this.targetRotation.premultiply(q).normalize();
  }

  private actionFor(e: PointerEvent): DragAction {
    if (e.button === 2) return e.shiftKey ? 'repel' : 'attract';
    if (e.button !== 0) return 'orbit';
    if (e.altKey) return 'tilt';
    if (e.shiftKey) return 'stir';
    return this.settings.dragAction;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.activeAction) return;
    const action = this.actionFor(e);
    if (action === 'orbit') {
      this.controls.enabled = true;
      return;
    }
    this.controls.enabled = false;
    this.activeAction = action;
    this.activePointer = e.pointerId;
    this.lastPointerPx.set(e.clientX, e.clientY);
    this.setPointer(e);
    this.prevPoint = null;
    this.smoothedVelocity.set(0, 0, 0);
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer || !this.activeAction) return;
    if (this.activeAction === 'tilt') {
      const dx = e.clientX - this.lastPointerPx.x;
      const dy = e.clientY - this.lastPointerPx.y;
      this.tiltBy(dy * DRAG_TILT_SPEED, -dx * DRAG_TILT_SPEED);
    }
    this.lastPointerPx.set(e.clientX, e.clientY);
    this.setPointer(e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    this.activeAction = null;
    this.activePointer = -1;
    this.controls.enabled = true;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (TILT_KEYS[e.code]) {
      this.keys.add(e.code);
      e.preventDefault();
    }
  };

  private setPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  private updateMouse(dt: number): void {
    const m = this.mouse;
    const action = this.activeAction;
    if (!action || action === 'tilt' || action === 'orbit') {
      m.mode = MOUSE_NONE;
      return;
    }

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const toLocal = this.boxRotation.clone().invert();
    const origin = this.raycaster.ray.origin.clone();
    const dir = this.raycaster.ray.direction.clone();

    // Point where the ray crosses the camera-facing plane through the container centre.
    const normal = new Vector3();
    this.camera.getWorldDirection(normal);
    const t = -origin.dot(normal) / dir.dot(normal);
    const point = origin.clone().addScaledVector(dir, t);

    if (this.prevPoint && dt > 0) {
      const v = point.clone().sub(this.prevPoint).divideScalar(dt);
      if (v.length() > MAX_MOUSE_SPEED) v.setLength(MAX_MOUSE_SPEED);
      this.smoothedVelocity.lerp(v, 0.5);
    }
    this.prevPoint = point.clone();

    origin.applyQuaternion(toLocal);
    dir.applyQuaternion(toLocal);
    point.applyQuaternion(toLocal);
    const vel = this.smoothedVelocity.clone().applyQuaternion(toLocal);

    m.rayOrigin = [origin.x, origin.y, origin.z];
    m.rayDir = [dir.x, dir.y, dir.z];
    m.point = [point.x, point.y, point.z];
    m.velocity = [vel.x, vel.y, vel.z];
    if (action === 'stir') {
      m.mode = MOUSE_STIR;
      m.radius = this.settings.radius;
      m.strength = this.settings.strength;
    } else {
      m.mode = MOUSE_ATTRACT;
      m.radius = this.settings.radius * ATTRACT_RADIUS_SCALE;
      m.strength = action === 'repel' ? -this.settings.strength : this.settings.strength;
    }
  }
}