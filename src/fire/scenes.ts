import type { Emitter, Vec3 } from './FireSimulator';

export const SCENES = ['Campfire', 'Gas burner', 'Fireballs', 'Torch'] as const;
export type SceneName = (typeof SCENES)[number];

/** Scenery drawn and simulated for each scene (see fireScene.glsl). */
export const SCENE_GEOMETRY: Record<SceneName, number> = { Campfire: 0, 'Gas burner': 1, Fireballs: 2, Torch: 2 };

export const FLAME_COLOURS: { name: string; hex: string; tint: Vec3 | null }[] = [
  { name: 'Natural', hex: '#ff8a1f', tint: null },
  { name: 'Gas blue', hex: '#3d7bff', tint: [0.25, 0.5, 1.0] },
  { name: 'Copper green', hex: '#2ee06a', tint: [0.25, 1.0, 0.4] },
  { name: 'Potassium violet', hex: '#a24dff', tint: [0.7, 0.3, 1.0] },
  { name: 'Strontium red', hex: '#ff2440', tint: [1.0, 0.12, 0.18] },
  { name: 'Sodium yellow', hex: '#ffd21f', tint: [1.0, 0.8, 0.15] },
];

interface Burst {
  position: Vec3;
  start: number;
}

const BURST_SECONDS = 0.18;
const BURST_INTERVAL = 1.7;

/** Emitters for the chosen scene. `size` scales how much fuel the scene burns. */
export class SceneEmitters {
  private bursts: Burst[] = [];
  private nextBurst = 0;

  constructor(private readonly ground: number) {}

  emitters(scene: SceneName, size: number, now: number): Emitter[] {
    const g = this.ground;
    switch (scene) {
      case 'Campfire':
        return [
          {
            shape: 'ellipsoid',
            position: [0, g + 0.07, 0],
            size: [0.15 * Math.sqrt(size), 0.05, 0.15 * Math.sqrt(size)],
            velocity: [0, 0.35, 0],
            push: 0.2,
            fuel: 16 * size,
            heat: 3,
            smoke: 0.2,
            flicker: 1,
          },
        ];
      case 'Gas burner':
        return [
          {
            shape: 'ring',
            position: [0, g + 0.135, 0],
            size: [0.25, 0.022, 0],
            velocity: [0, 0.9 * Math.sqrt(size), 0],
            push: 0.8,
            fuel: 14 * size,
            heat: 4,
            smoke: 0,
            flicker: 0.25,
          },
        ];
      case 'Fireballs':
        return this.fireballs(size, now);
      default:
        return [];
    }
  }

  private fireballs(size: number, now: number): Emitter[] {
    if (now >= this.nextBurst) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.3;
      this.bursts.push({ position: [Math.cos(a) * r, this.ground + 0.16, Math.sin(a) * r], start: now });
      this.nextBurst = now + BURST_INTERVAL * (0.7 + Math.random() * 0.6);
    }
    this.bursts = this.bursts.filter((b) => now - b.start < BURST_SECONDS);
    return this.bursts.map((b) => ({
      shape: 'burst' as const,
      position: b.position,
      size: [0.1, 0.1, 0.1] as Vec3,
      velocity: [1.4 * Math.sqrt(size), 1.2, 0] as Vec3,
      push: 0.9,
      fuel: 45 * size,
      heat: 10,
      smoke: 2,
      flicker: 1,
    }));
  }
}
