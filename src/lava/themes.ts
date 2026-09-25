import type { Vec3 } from '../sim/SPHSimulator';

export interface Theme {
  name: string;
  /** Linear colours. */
  wax: Vec3;
  liquid: Vec3;
  /** CSS colours for the swatch: wax on liquid. */
  swatch: [string, string];
}

export const THEMES: Theme[] = [
  { name: 'Classic', wax: [1.0, 0.16, 0.03], liquid: [1.0, 0.62, 0.12], swatch: ['#ff4a12', '#ffc04a'] },
  { name: 'Ocean', wax: [0.12, 0.35, 1.0], liquid: [0.5, 0.18, 0.85], swatch: ['#3a8cff', '#a45ae6'] },
  { name: 'Lime', wax: [0.35, 1.0, 0.08], liquid: [1.0, 0.85, 0.25], swatch: ['#9dff3a', '#ffe98a'] },
  { name: 'Bubblegum', wax: [1.0, 0.22, 0.55], liquid: [0.75, 0.8, 1.0], swatch: ['#ff6fb5', '#dfe6ff'] },
  { name: 'Galaxy', wax: [0.6, 0.12, 1.0], liquid: [0.12, 0.75, 0.8], swatch: ['#b25aff', '#48d6e0'] },
];
