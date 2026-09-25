/**
 * Keep the page on its background colour until the simulation has drawn a frame, so navigating
 * between pages never shows a white or half-built screen.
 */
const started = performance.now();
let painted = false;

function reveal(): void {
  document.body.classList.add('ready');
}

function check(): void {
  const error = document.getElementById('error');
  if (error && !error.hidden) {
    reveal();
    return;
  }
  const canvas = document.getElementById('app') as HTMLCanvasElement | null;
  if (canvas && canvas.width > 1) {
    if (painted) {
      reveal();
      return;
    }
    painted = true;
  }
  if (performance.now() - started > 8000) {
    reveal();
    return;
  }
  requestAnimationFrame(check);
}

requestAnimationFrame(check);
