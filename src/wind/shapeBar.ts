import { SHAPES, type ShapeName } from './obstacle';

/** Bottom toolbar: one button per object shape (keys 1-5). */
export class ShapeBar {
  private readonly buttons = new Map<ShapeName, HTMLButtonElement>();

  constructor(container: HTMLElement, onPick: (shape: ShapeName) => void) {
    SHAPES.forEach((shape, i) => {
      const b = document.createElement('button');
      b.className = 'text';
      b.textContent = shape;
      b.title = `${shape} (${i + 1})`;
      b.addEventListener('click', () => onPick(shape));
      this.buttons.set(shape, b);
      container.append(b);
    });
  }

  select(shape: ShapeName): void {
    for (const [name, b] of this.buttons) {
      b.classList.toggle('selected', name === shape);
      b.setAttribute('aria-pressed', String(name === shape));
    }
  }
}
