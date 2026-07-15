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
    const world = (await res.json()) as { courses: { holes: unknown[] }[] };
    const n = world.courses.reduce((s, c) => s + c.holes.length, 0);
    if (n > 0) {
      stats.textContent = `${n} holes and growing — beat the records, then build your own.`;
    }
  } catch {
    // keep the default tagline
  }
})();
