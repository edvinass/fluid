import { FLAME_COLOURS, SCENES, type SceneName } from './scenes';

/** Bottom toolbar: scene buttons (keys 1-4) and flame colour swatches. */
export class FireToolbar {
  private readonly sceneButtons = new Map<SceneName, HTMLButtonElement>();
  private readonly swatches = new Map<string, HTMLButtonElement>();

  constructor(container: HTMLElement, onScene: (scene: SceneName) => void, onColour: (name: string) => void) {
    SCENES.forEach((scene, i) => {
      const b = document.createElement('button');
      b.className = 'text';
      b.textContent = scene;
      b.title = `${scene} (${i + 1})`;
      b.addEventListener('click', () => onScene(scene));
      this.sceneButtons.set(scene, b);
      container.append(b);
    });
    const divider = document.createElement('span');
    divider.className = 'divider';
    container.append(divider);
    for (const c of FLAME_COLOURS) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.style.background = c.hex;
      b.addEventListener('click', () => onColour(c.name));
      this.swatches.set(c.name, b);
      container.append(b);
    }
  }

  select(scene: SceneName, colour: string): void {
    for (const [name, b] of this.sceneButtons) {
      b.classList.toggle('selected', name === scene);
      b.setAttribute('aria-pressed', String(name === scene));
    }
    for (const [name, b] of this.swatches) {
      b.classList.toggle('selected', name === colour);
      b.setAttribute('aria-pressed', String(name === colour));
    }
  }
}
