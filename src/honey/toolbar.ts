import { MATERIALS, SCENES, type SceneName } from './scenes';

/** Bottom toolbar: scene buttons (keys 1-3) and liquid swatches. */
export class HoneyToolbar {
  private readonly sceneButtons = new Map<SceneName, HTMLButtonElement>();
  private readonly swatches = new Map<string, HTMLButtonElement>();

  constructor(container: HTMLElement, onScene: (scene: SceneName) => void, onMaterial: (name: string) => void) {
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
    for (const m of MATERIALS) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.title = m.name;
      b.setAttribute('aria-label', m.name);
      b.style.background = m.swatch;
      b.addEventListener('click', () => onMaterial(m.name));
      this.swatches.set(m.name, b);
      container.append(b);
    }
  }

  select(scene: SceneName, material: string): void {
    for (const [name, b] of this.sceneButtons) {
      b.classList.toggle('selected', name === scene);
      b.setAttribute('aria-pressed', String(name === scene));
    }
    for (const [name, b] of this.swatches) {
      b.classList.toggle('selected', name === material);
      b.setAttribute('aria-pressed', String(name === material));
    }
  }
}
