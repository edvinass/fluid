import type { PaintSource, Vec3 } from './PaintSimulator';
import type { PourSettings } from './interaction';

interface Pour {
  position: Vec3;
  drift: Vec3;
  color: Vec3;
  start: number;
  end: number;
}

const IDLE_BEFORE_AUTO = 6;
const MAX_CONCURRENT = 2;

/** Pours paint on its own at the start and whenever the user has been idle for a while. */
export class AutoPour {
  private pours: Pour[] = [];
  private nextAt: number;

  constructor(
    private readonly boxHalf: Vec3,
    private readonly settings: PourSettings,
    private readonly randomColor: () => Vec3,
    startTime: number,
  ) {
    // Open with a few quick pours so the tank is never empty on arrival.
    this.nextAt = startTime + 0.4;
  }

  sources(now: number, idleTime: number, introOver: boolean): PaintSource[] {
    this.pours = this.pours.filter((p) => p.end > now);
    const active = this.settings.autoPour && (!introOver || idleTime > IDLE_BEFORE_AUTO);
    if (active && now >= this.nextAt && this.pours.length < MAX_CONCURRENT) {
      this.spawn(now);
      this.nextAt = now + (introOver ? 1.4 + Math.random() * 2 : 0.9 + Math.random() * 0.6);
    }
    return this.pours.map((p) => {
      const t = now - p.start;
      return {
        position: [p.position[0] + p.drift[0] * t, p.position[1], p.position[2] + p.drift[2] * t],
        velocity: [p.drift[0], -this.settings.speed, p.drift[2]],
        color: p.color,
        amount: this.settings.rate,
        radius: this.settings.width,
        stretch: 2.5,
      };
    });
  }

  private spawn(now: number): void {
    const [hx, hy, hz] = this.boxHalf;
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 0.15;
    this.pours.push({
      position: [(Math.random() - 0.5) * hx * 1.1, hy - 0.06, (Math.random() - 0.5) * hz * 1.1],
      drift: [Math.cos(angle) * speed, 0, Math.sin(angle) * speed],
      color: this.randomColor(),
      start: now,
      end: now + 0.5 + Math.random() * 0.9,
    });
  }
}
