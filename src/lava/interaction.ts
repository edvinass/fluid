import { MOUSE, Raycaster, TOUCH, Vector2, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MOUSE_NONE, MOUSE_STIR, type MouseForce } from '../sim/SPHSimulator';

const MAX_MOUSE_SPEED = 3;
/** Seconds without input before the camera starts slowly circling the lamp. */
const IDLE_ORBIT = 10;

/**
 * Drag to push the wax around (as if poking it through the glass), orbit with the right button,
 * Ctrl + drag or two fingers. The camera drifts around the lamp when left alone.
 */
export class LavaInteraction {
  readonly controls: OrbitControls;
  readonly mouse: MouseForce = {
    mode: MOUSE_NONE,
    rayOrigin: [0, 0, 0],
    rayDir: [0, 0, -1],
    point: [0, 0, 0],
    velocity: [0, 0, 0],
    radius: 0.08,
    strength: 1,
  };
  idleTime = 0;

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private pointerId = -1;
  private prevPoint: Vector3 | null = null;
  private readonly velocity = new Vector3();

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 6;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.05;
    this.controls.autoRotateSpeed = 0.4;
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    this.controls.touches = { ONE: null as unknown as TOUCH, TWO: TOUCH.DOLLY_ROTATE };
    this.controls.addEventListener('start', () => (this.idleTime = 0));

    canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', () => (this.idleTime = 0), { passive: true });
  }

  get pressing(): boolean {
    return this.pointerId !== -1;
  }

  update(dt: number): void {
    this.idleTime = this.pressing ? 0 : this.idleTime + dt;
    this.controls.autoRotate = this.idleTime > IDLE_ORBIT;
    this.controls.update(dt);
    const m = this.mouse;
    if (!this.pressing) {
      m.mode = MOUSE_NONE;
      this.prevPoint = null;
      return;
    }
    // The pointer ray, and where it crosses the camera-facing plane through the lamp's axis.
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const normal = new Vector3();
    this.camera.getWorldDirection(normal);
    const point = origin.clone().addScaledVector(direction, -origin.dot(normal) / direction.dot(normal));
    if (this.prevPoint && dt > 0) {
      const v = point.clone().sub(this.prevPoint).divideScalar(dt);
      if (v.length() > MAX_MOUSE_SPEED) v.setLength(MAX_MOUSE_SPEED);
      this.velocity.lerp(v, 0.5);
    }
    this.prevPoint = point;
    m.mode = MOUSE_STIR;
    m.rayOrigin = origin.toArray() as [number, number, number];
    m.rayDir = direction.toArray() as [number, number, number];
    m.point = point.toArray() as [number, number, number];
    m.velocity = this.velocity.toArray() as [number, number, number];
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
    this.pointerId = e.pointerId;
    this.velocity.set(0, 0, 0);
    this.setPointer(e);
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
    this.pointerId = -1;
    this.controls.enabled = true;
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }
}
