import { Euler, Matrix3, Matrix4, Vector3, type Ray } from 'three';
import type { Program } from '../gl/program';

export type Vec3 = [number, number, number];

export const SHAPES = ['Sphere', 'Cylinder', 'Cube', 'Wing', 'Car'] as const;
export type ShapeName = (typeof SHAPES)[number];

export interface ObjectSettings {
  shape: ShapeName;
  /** Angle of attack in degrees (nose up is positive). */
  angle: number;
  /** Rotation about the vertical axis in degrees. */
  yaw: number;
  size: number;
}

interface ShapeInfo {
  /** Bounding sphere radius at size 1, in world units. */
  bound: number;
  /** Box used for picking, in object space. */
  pickCenter: Vec3;
  pickHalf: Vec3;
  /** Rests on the tunnel floor and doesn't pitch. */
  grounded?: boolean;
  /** Half the height of a grounded shape, from its origin to the floor. */
  groundOffset?: number;
}

const SHAPE_INFO: Record<ShapeName, ShapeInfo> = {
  Sphere: { bound: 0.21, pickCenter: [0, 0, 0], pickHalf: [0.2, 0.2, 0.2] },
  Cylinder: { bound: 0, pickCenter: [0, 0, 0], pickHalf: [0.11, 0.11, 4] },
  Cube: { bound: 0.27, pickCenter: [0, 0, 0], pickHalf: [0.15, 0.15, 0.15] },
  Wing: { bound: 0.62, pickCenter: [0.12, 0, 0], pickHalf: [0.3, 0.06, 0.42] },
  Car: { bound: 0.48, pickCenter: [0, 0, 0], pickHalf: [0.42, 0.14, 0.18], grounded: true, groundOffset: 0.14 },
};

const MAX_SPEED = 3;

/** The object in the tunnel: its shape, pose and velocity, and the shader uniforms describing it. */
export class Obstacle {
  readonly position = new Vector3();
  /** World units per second, smoothed. */
  readonly velocity = new Vector3();
  /** World-to-object rotation (column-major mat3). */
  readonly rotation = new Float32Array(9);
  shapeIndex = 0;
  scale = 1;
  bound = 0.2;

  private readonly target = new Vector3();
  private readonly prev = new Vector3();
  private readonly localToWorld = new Matrix4();
  private readonly worldToLocal = new Matrix4();
  private readonly m3 = new Matrix3();
  private info: ShapeInfo = SHAPE_INFO.Sphere;

  constructor(private readonly tunnelHalf: Vec3) {}

  /** Puts the object back in its starting spot, a third of the way down the tunnel. */
  resetPosition(settings: ObjectSettings): void {
    this.info = SHAPE_INFO[settings.shape];
    this.target.set(-this.tunnelHalf[0] * 0.45, 0, 0);
    this.clampTarget(settings);
    this.position.copy(this.target);
    this.prev.copy(this.target);
    this.velocity.set(0, 0, 0);
  }

  /** Moves the object towards `p` (world), kept inside the tunnel. */
  moveTo(p: Vector3, settings: ObjectSettings): void {
    this.target.copy(p);
    this.clampTarget(settings);
  }

  update(settings: ObjectSettings, dt: number): void {
    this.info = SHAPE_INFO[settings.shape];
    this.shapeIndex = SHAPES.indexOf(settings.shape);
    this.scale = settings.size;
    this.clampTarget(settings);
    this.prev.copy(this.position);
    this.position.lerp(this.target, 1 - Math.exp(-dt * 25));
    if (dt > 0) {
      const v = this.position.clone().sub(this.prev).divideScalar(dt);
      if (v.length() > MAX_SPEED) v.setLength(MAX_SPEED);
      this.velocity.lerp(v, 0.5);
    }

    const pitch = this.info.grounded ? 0 : (settings.angle * Math.PI) / 180;
    const yaw = (settings.yaw * Math.PI) / 180;
    this.localToWorld.makeRotationFromEuler(new Euler(0, yaw, -pitch, 'YXZ'));
    this.worldToLocal.copy(this.localToWorld).transpose();
    this.m3.setFromMatrix4(this.worldToLocal);
    this.rotation.set(this.m3.elements);

    const [, , hz] = this.tunnelHalf;
    this.bound =
      settings.shape === 'Cylinder' ? Math.hypot(0.11 * this.scale, hz * 1.5) + 0.01 : this.info.bound * this.scale;
  }

  setUniforms(p: Program): void {
    p.set('uShape', this.shapeIndex)
      .set('uObsPos', [this.position.x, this.position.y, this.position.z])
      .set('uObsRot', this.rotation)
      .set('uObsScale', this.scale)
      .set('uObsBound', this.bound)
      .set('uTunnelHalf', this.tunnelHalf);
  }

  /** Distance along the ray to the object's pick box, or null if it misses. */
  pick(ray: Ray): number | null {
    const o = ray.origin.clone().sub(this.position).applyMatrix4(this.worldToLocal).divideScalar(this.scale);
    const d = ray.direction.clone().applyMatrix4(this.worldToLocal);
    const c = this.info.pickCenter;
    const h = this.info.pickHalf;
    const margin = 0.04 / this.scale;
    let t0 = -Infinity;
    let t1 = Infinity;
    for (let k = 0; k < 3; k++) {
      const ok = o.getComponent(k) - c[k];
      const dk = d.getComponent(k);
      const hk = h[k] + margin;
      if (Math.abs(dk) < 1e-8) {
        if (Math.abs(ok) > hk) return null;
        continue;
      }
      const a = (-hk - ok) / dk;
      const b = (hk - ok) / dk;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    return t1 >= Math.max(t0, 0) ? Math.max(t0, 0) * this.scale : null;
  }

  private clampTarget(settings: ObjectSettings): void {
    const [hx, hy, hz] = this.tunnelHalf;
    const t = this.target;
    t.x = Math.max(-hx + 0.35, Math.min(hx - 0.4, t.x));
    t.y = Math.max(-hy + 0.12, Math.min(hy - 0.12, t.y));
    t.z = Math.max(-hz + 0.12, Math.min(hz - 0.12, t.z));
    if (settings.shape === 'Cylinder') t.z = 0;
    if (this.info.grounded) t.y = -hy + (this.info.groundOffset ?? 0) * settings.size;
  }
}
