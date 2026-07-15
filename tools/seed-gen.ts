// Generates the 36-hole starter course: four themed nines. Layouts are
// hand-patterned; a brute-force solver then finds a genuine one-stroke
// solution through the real physics engine — the same proof any player
// must supply to publish. If a design has no possible ace, a fixer
// carves hazards away from the tee-cup line until it does.
// Run: npx tsx tools/seed-gen.ts

import {
  GRID_COLS,
  GRID_ROWS,
  TILE,
  type HoleLayout,
  type Shot,
  type Theme,
} from '../src/shared/types';
import { simulateShot, cellCenter, validateRun, MAX_SHOT_SPEED } from '../src/shared/physics';

function base(): number[] {
  const cells = new Array(GRID_COLS * GRID_ROWS).fill(TILE.GRASS);
  for (let c = 0; c < GRID_COLS; c++) {
    cells[c] = TILE.WALL;
    cells[(GRID_ROWS - 1) * GRID_COLS + c] = TILE.WALL;
  }
  for (let r = 0; r < GRID_ROWS; r++) {
    cells[r * GRID_COLS] = TILE.WALL;
    cells[r * GRID_COLS + GRID_COLS - 1] = TILE.WALL;
  }
  return cells;
}
const set = (cells: number[], c: number, r: number, t: number) => {
  if (c >= 1 && c <= GRID_COLS - 2 && r >= 1 && r <= GRID_ROWS - 2) cells[r * GRID_COLS + c] = t;
};
const row = (cells: number[], r: number, c0: number, c1: number, t: number) => {
  for (let c = c0; c <= c1; c++) set(cells, c, r, t);
};
const col = (cells: number[], c: number, r0: number, r1: number, t: number) => {
  for (let r = r0; r <= r1; r++) set(cells, c, r, t);
};
const rect = (cells: number[], c0: number, r0: number, c1: number, r1: number, t: number) => {
  for (let r = r0; r <= r1; r++) row(cells, r, c0, c1, t);
};

type Seed = { name: string; theme: Theme; layout: HoleLayout };
const seeds: Seed[] = [];
const add = (name: string, theme: Theme, cells: number[], tee: [number, number], cup: [number, number]) =>
  seeds.push({ name, theme, layout: { cells, tee: { x: tee[0], y: tee[1] }, cup: { x: cup[0], y: cup[1] } } });

// ═══ MEADOW SPRINGS (classic) ═══
{
  let c = base();
  add('The Opener', 'meadow', c, [6, 13], [6, 3]);

  c = base();
  row(c, 8, 1, 7, TILE.WALL);
  add('First Bend', 'meadow', c, [3, 13], [3, 3]);

  c = base();
  rect(c, 3, 7, 8, 9, TILE.SAND);
  add('Sandpit Alley', 'meadow', c, [6, 13], [6, 3]);

  c = base();
  col(c, 4, 5, 10, TILE.WATER);
  col(c, 8, 5, 10, TILE.WATER);
  add('The Strait', 'meadow', c, [6, 13], [6, 3]);

  c = base();
  row(c, 6, 5, 10, TILE.WALL);
  row(c, 10, 1, 6, TILE.WALL);
  add('Zigzag', 'meadow', c, [6, 13], [8, 3]);

  c = base();
  for (let cc = 4; cc <= 8; cc++)
    for (let rr = 2; rr <= 6; rr++) {
      if (cc === 4 || cc === 8 || rr === 2 || rr === 6) set(c, cc, rr, TILE.WATER);
    }
  set(c, 6, 6, TILE.GRASS);
  add('Island Cup', 'meadow', c, [6, 13], [6, 4]);

  c = base();
  col(c, 7, 2, 7, TILE.WALL);
  row(c, 7, 7, 10, TILE.WALL);
  add('Bank Job', 'meadow', c, [4, 13], [9, 4]);

  c = base();
  set(c, 3, 5, TILE.WATER);
  set(c, 8, 6, TILE.WATER);
  set(c, 5, 8, TILE.SAND);
  set(c, 6, 8, TILE.SAND);
  set(c, 4, 10, TILE.WATER);
  set(c, 9, 10, TILE.SAND);
  set(c, 7, 4, TILE.SAND);
  add('Minefield', 'meadow', c, [6, 13], [4, 3]);

  c = base();
  col(c, 3, 3, 10, TILE.SAND);
  col(c, 9, 3, 10, TILE.SAND);
  row(c, 5, 4, 5, TILE.WALL);
  set(c, 5, 11, TILE.WATER);
  set(c, 7, 11, TILE.WATER);
  add('The Gauntlet', 'meadow', c, [6, 13], [6, 3]);
}

// ═══ SUNBAKED DUNES (sand world) ═══
{
  let c = base();
  rect(c, 1, 6, 10, 8, TILE.SAND);
  add('Three Dunes', 'dunes', c, [6, 13], [6, 3]);

  c = base();
  rect(c, 1, 4, 5, 12, TILE.SAND);
  add('Half Desert', 'dunes', c, [3, 13], [3, 3]);

  c = base();
  rect(c, 4, 2, 8, 6, TILE.SAND);
  set(c, 6, 4, TILE.GRASS);
  add('Oasis', 'dunes', c, [6, 13], [6, 4]);

  c = base();
  row(c, 7, 4, 10, TILE.WALL);
  rect(c, 1, 8, 3, 10, TILE.SAND);
  add('Caravan Pass', 'dunes', c, [8, 13], [8, 3]);

  c = base();
  for (let i = 0; i < 6; i++) {
    set(c, 2 + i * 1.6, 4 + i, TILE.SAND);
    set(c, 3 + i * 1.6, 4 + i, TILE.SAND);
  }
  add('Snake Dune', 'dunes', c, [6, 13], [6, 2]);

  c = base();
  rect(c, 4, 7, 8, 9, TILE.SAND);
  rect(c, 5, 8, 7, 8, TILE.WATER);
  add('Mirage Pool', 'dunes', c, [6, 13], [6, 3]);

  c = base();
  col(c, 6, 3, 11, TILE.SAND);
  col(c, 5, 5, 9, TILE.SAND);
  col(c, 7, 5, 9, TILE.SAND);
  row(c, 4, 3, 8, TILE.WALL);
  add('Sandstorm Wall', 'dunes', c, [3, 13], [9, 2]);

  c = base();
  rect(c, 2, 3, 4, 5, TILE.SAND);
  rect(c, 7, 5, 9, 7, TILE.SAND);
  rect(c, 3, 8, 5, 10, TILE.SAND);
  rect(c, 7, 10, 9, 12, TILE.SAND);
  add('Dune Hopper', 'dunes', c, [6, 13], [6, 2]);

  c = base();
  rect(c, 1, 5, 10, 6, TILE.SAND);
  rect(c, 1, 9, 10, 10, TILE.SAND);
  row(c, 7, 4, 7, TILE.WATER);
  add('The Crossing', 'dunes', c, [6, 13], [6, 3]);
}

// ═══ FROSTBITE FALLS (ice world) ═══
{
  let c = base();
  rect(c, 1, 5, 10, 10, TILE.ICE);
  add('First Frost', 'frost', c, [6, 13], [6, 3]);

  c = base();
  rect(c, 1, 3, 10, 12, TILE.ICE);
  rect(c, 4, 7, 7, 8, TILE.GRASS);
  add('The Rink', 'frost', c, [6, 13], [6, 2]);

  c = base();
  col(c, 4, 3, 10, TILE.ICE);
  col(c, 5, 3, 10, TILE.ICE);
  col(c, 8, 5, 12, TILE.WATER);
  add('Glacier Lane', 'frost', c, [6, 13], [4, 2]);

  c = base();
  rect(c, 2, 4, 9, 6, TILE.ICE);
  rect(c, 2, 9, 9, 11, TILE.ICE);
  row(c, 7, 4, 7, TILE.WALL);
  add('Twin Floes', 'frost', c, [6, 13], [6, 2]);

  c = base();
  rect(c, 1, 2, 10, 13, TILE.ICE);
  set(c, 6, 13, TILE.GRASS);
  rect(c, 5, 6, 7, 7, TILE.WATER);
  add('Thin Ice', 'frost', c, [6, 13], [6, 3]);

  c = base();
  rect(c, 3, 3, 8, 5, TILE.ICE);
  rect(c, 3, 8, 8, 10, TILE.ICE);
  set(c, 2, 6, TILE.WALL);
  set(c, 9, 7, TILE.WALL);
  add('Avalanche Alley', 'frost', c, [6, 13], [6, 2]);

  c = base();
  rect(c, 1, 4, 5, 12, TILE.ICE);
  rect(c, 7, 2, 10, 9, TILE.ICE);
  row(c, 6, 5, 8, TILE.WALL);
  add('Frozen Fork', 'frost', c, [3, 13], [9, 3]);

  c = base();
  rect(c, 2, 2, 9, 4, TILE.ICE);
  rect(c, 2, 6, 9, 8, TILE.ICE);
  rect(c, 2, 10, 9, 12, TILE.ICE);
  add('Triple Slide', 'frost', c, [6, 13], [6, 3]);

  c = base();
  rect(c, 1, 2, 10, 12, TILE.ICE);
  set(c, 4, 5, TILE.WALL);
  set(c, 7, 7, TILE.WALL);
  set(c, 3, 9, TILE.WALL);
  set(c, 8, 4, TILE.WALL);
  add('Ice Pinball', 'frost', c, [6, 13], [6, 2]);
}

// ═══ WHISPERING WOODS (forest maze) ═══
{
  let c = base();
  for (const [tc, tr] of [[3, 4], [8, 5], [5, 7], [2, 9], [9, 9], [6, 10]] as const) set(c, tc, tr, TILE.WALL);
  add('Tree Line', 'forest', c, [6, 13], [6, 2]);

  c = base();
  row(c, 5, 1, 8, TILE.WALL);
  row(c, 9, 3, 10, TILE.WALL);
  set(c, 5, 7, TILE.WALL);
  add('Forest Gates', 'forest', c, [6, 13], [3, 3]);

  c = base();
  col(c, 3, 2, 6, TILE.WALL);
  col(c, 8, 8, 12, TILE.WALL);
  rect(c, 5, 6, 6, 7, TILE.WATER);
  add('Creek Bend', 'forest', c, [6, 13], [2, 2]);

  c = base();
  for (const [tc, tr] of [[2, 3], [4, 3], [6, 3], [8, 3], [3, 6], [5, 6], [7, 6], [9, 6], [2, 9], [4, 9], [6, 9], [8, 9]] as const)
    set(c, tc, tr, TILE.WALL);
  add('The Orchard', 'forest', c, [6, 13], [10, 2]);

  c = base();
  row(c, 4, 4, 10, TILE.WALL);
  row(c, 8, 1, 7, TILE.WALL);
  row(c, 11, 5, 10, TILE.WALL);
  set(c, 2, 6, TILE.SAND);
  add('Deer Trail', 'forest', c, [8, 13], [8, 2]);

  c = base();
  rect(c, 4, 5, 7, 8, TILE.WALL);
  rect(c, 5, 6, 6, 7, TILE.GRASS);
  set(c, 5, 8, TILE.GRASS);
  add('The Hollow', 'forest', c, [6, 13], [5, 7]);

  c = base();
  col(c, 5, 2, 9, TILE.WALL);
  rect(c, 7, 4, 9, 5, TILE.WATER);
  rect(c, 1, 10, 4, 11, TILE.SAND);
  add('Mossy Path', 'forest', c, [3, 13], [8, 2]);

  c = base();
  for (const [tc, tr] of [[3, 3], [7, 3], [5, 5], [2, 7], [8, 7], [4, 9], [6, 11]] as const) {
    set(c, tc, tr, TILE.WALL);
    set(c, tc + 1, tr, TILE.WALL);
  }
  add('Thicket', 'forest', c, [6, 13], [5, 2]);

  c = base();
  row(c, 6, 3, 10, TILE.WALL);
  col(c, 3, 6, 10, TILE.WALL);
  rect(c, 6, 8, 8, 9, TILE.WATER);
  set(c, 9, 11, TILE.SAND);
  add('Owl Corner', 'forest', c, [8, 13], [6, 3]);
}

// ── Solver + fixer ──────────────────────────────────────────────
function solveAce(layout: HoleLayout): Shot | null {
  const start = cellCenter(layout.tee);
  for (let power = 8; power <= MAX_SHOT_SPEED; power += 0.5) {
    for (let deg = 0; deg < 360; deg += 0.5) {
      const a = (deg * Math.PI) / 180;
      const shot: Shot = {
        start: { x: start.x, y: start.y },
        vel: { x: Math.cos(a) * power, y: Math.sin(a) * power },
      };
      const res = simulateShot(layout, shot);
      if (res.sunk) return shot;
    }
  }
  return null;
}

// carve the hazard cell nearest the tee→cup line and retry
function fixUntilAceable(s: Seed): Shot | null {
  for (let attempt = 0; attempt < 10; attempt++) {
    const ace = solveAce(s.layout);
    if (ace) return ace;
    const { tee, cup } = s.layout;
    let worst = -1;
    let worstDist = Infinity;
    for (let r = 1; r < GRID_ROWS - 1; r++) {
      for (let cc = 1; cc < GRID_COLS - 1; cc++) {
        const idx = r * GRID_COLS + cc;
        if (s.layout.cells[idx] === TILE.GRASS || s.layout.cells[idx] === TILE.ICE) continue;
        // distance from cell to the tee-cup segment midpointish heuristic
        const t = Math.max(0, Math.min(1, ((cc - tee.x) * (cup.x - tee.x) + (r - tee.y) * (cup.y - tee.y)) /
          ((cup.x - tee.x) ** 2 + (cup.y - tee.y) ** 2 || 1)));
        const px = tee.x + t * (cup.x - tee.x);
        const py = tee.y + t * (cup.y - tee.y);
        const d = Math.hypot(cc - px, r - py);
        if (d < worstDist) {
          worstDist = d;
          worst = idx;
        }
      }
    }
    if (worst < 0) return null;
    s.layout.cells[worst] = TILE.GRASS;
    console.error(`  fixer: cleared cell ${worst} in "${s.name}" (attempt ${attempt + 1})`);
  }
  return null;
}

const out: { name: string; theme: Theme; layout: HoleLayout; ace: Shot }[] = [];
for (const s of seeds) {
  const ace = fixUntilAceable(s);
  if (!ace) {
    console.error(`✗ UNFIXABLE: ${s.name}`);
    continue;
  }
  const check = validateRun(s.layout, [ace]);
  if (!check.valid || check.strokes !== 1) {
    console.error(`✗ VALIDATION FAILED: ${s.name}`);
    continue;
  }
  console.error(`✓ [${s.theme}] ${s.name}`);
  out.push({ name: s.name, theme: s.theme, layout: s.layout, ace });
}
console.error(`total: ${out.length}/${seeds.length}`);
console.log(JSON.stringify(out));
