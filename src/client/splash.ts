import { requestExpandedMode } from '@devvit/web/client';

const startButton = document.getElementById('start-button') as HTMLButtonElement;
const stats = document.getElementById('stats') as HTMLParagraphElement;

startButton.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});

// live teaser: how big has the course grown?
void (async () => {
  try {
    const res = await fetch('/api/world');
    if (!res.ok) return;
    const world = (await res.json()) as { holes: { record: { strokes: number } | null }[] };
    const n = world.holes.length;
    if (n > 0) {
      stats.textContent = `${n} hole${n === 1 ? '' : 's'} built so far — beat the records, then add your own.`;
    }
  } catch {
    // keep the default tagline
  }
})();
