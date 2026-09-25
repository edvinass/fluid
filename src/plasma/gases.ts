import type { Vec3 } from './PlasmaSimulator';

export interface Gas {
  name: string;
  /** Colour of the threads, or null to give every filament its own shifting hue. */
  thread: Vec3 | null;
  /** Colour of the glow around the electrode and where the threads meet the glass. */
  glow: Vec3 | null;
  /** CSS colour for the toolbar swatch. */
  swatch: string;
}

export const GASES: Gas[] = [
  { name: 'Neon & argon', thread: [0.45, 0.3, 1], glow: [1, 0.2, 0.36], swatch: 'linear-gradient(135deg, #8a6bff 45%, #ff3a6a 55%)' },
  { name: 'Neon', thread: [1, 0.36, 0.14], glow: [1, 0.18, 0.08], swatch: '#ff5a1f' },
  { name: 'Argon', thread: [0.48, 0.4, 1], glow: [0.62, 0.32, 1], swatch: '#6b52ff' },
  { name: 'Xenon', thread: [0.32, 0.55, 1], glow: [0.42, 0.42, 1], swatch: '#478cff' },
  { name: 'Helium', thread: [1, 0.6, 0.5], glow: [1, 0.38, 0.32], swatch: '#ff8a70' },
  { name: 'Krypton', thread: [0.75, 0.85, 1], glow: [0.72, 0.72, 1], swatch: '#c4d6ff' },
  { name: 'Rainbow', thread: null, glow: null, swatch: 'conic-gradient(#ff3b6b, #ffb13b, #3bff9d, #3bb4ff, #b13bff, #ff3b6b)' },
];

export function hueColor(h: number): Vec3 {
  const c = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.max(0, Math.min(1, Math.abs(k - 3) - 1));
  };
  return [c(5), c(3), c(1)];
}
