// Generates the starter holes: hand-designed layouts + a brute-force
// solver that finds a genuine one-stroke solution through the real
// physics engine. Output is pasted into src/server/core/seeds.ts.
// Run: npx tsx tools/seed-gen.ts

import { GRID_COLS, GRID_ROWS, TILE, type HoleLayout, type Shot } from '../src/shared/types';
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
  cells[r * GRID_COLS + c] = t;
};
const row = (cells: number[], r: number, c0: number, c1: number, t: number) => {
  for (let c = c0; c <= c1; c++) set(cells, c, r, t);
};
const col = (cells: number[], c: number, r0: number, r1: number, t: number) => {
  for (let r = r0; r <= r1; r++) set(cells, c, r, t);
};

type Seed = { name: string; layout: HoleLayout };

const seeds: Seed[] = [];

// 1 — The Opener: straight lane, friendly
{
  const cells = base();
  seeds.push({ name: 'The Opener', layout: { cells, tee: { x: 6, y: 13 }, cup: { x: 6, y: 3 } } });
}

// 2 — First Bend: one wall forces a bank shot
{
  const cells = base();
  row(cells, 8, 1, 7, TILE.WALL);
  seeds.push({ name: 'First Bend', layout: { cells, tee: { x: 3, y: 13 }, cup: { x: 3, y: 3 } } });
}

// 3 — Sandpit Alley: sand field in the middle
{
  const cells = base();
  for (let r = 7; r <= 9; r++) row(cells, r, 3, 8, TILE.SAND);
  seeds.push({ name: 'Sandpit Alley', layout: { cells, tee: { x: 6, y: 13 }, cup: { x: 6, y: 3 } } });
}

// 4 — The Strait: water channels squeeze the lane
{
  const cells = base();
  col(cells, 4, 5, 10, TILE.WATER);
  col(cells, 8, 5, 10, TILE.WATER);
  seeds.push({ name: 'The Strait', layout: { cells, tee: { x: 6, y: 13 }, cup: { x: 6, y: 3 } } });
}

// 5 — Zigzag: two staggered walls with generous offset gaps
{
  const cells = base();
  row(cells, 6, 5, 10, TILE.WALL); // gap on the left (c1–4)
  row(cells, 10, 1, 6, TILE.WALL); // gap on the right (c7–10)
  seeds.push({ name: 'Zigzag', layout: { cells, tee: { x: 6, y: 13 }, cup: { x: 8, y: 3 } } });
}

// 6 — Island Cup: cup guarded by a water moat with one gap
{
  const cells = base();
  // moat ring around cup at (6,4)
  for (let c = 4; c <= 8; c++)
    for (let r = 2; r <= 6; r++) {
      if (c === 4 || c === 8 || r === 2 || r === 6) set(cells, c, r, TILE.WATER);
    }
  set(cells, 6, 6, TILE.GRASS); // southern gate
  seeds.push({ name: 'Island Cup', layout: { cells, tee: { x: 6, y: 13 }, cup: { x: 6, y: 4 } } });
}

// 7 — Bank Job: cup tucked behind an L — bank off the side wall
{
  const cells = base();
  col(cells, 7, 2, 7, TILE.WALL);
  row(cells, 7, 7, 10, TILE.WALL);
  seeds.push({ name: 'Bank Job', layout: { cells, tee: { x: 4, y: 13 }, cup: { x: 9, y: 4 } } });
}

// 8 — Minefield: scattered sand + water pockets
{
  const cells = base();
  set(cells, 3, 5, TILE.WATER);
  set(cells, 8, 6, TILE.WATER);
  set(cells, 5, 8, TILE.SAND);
  set(cells, 6, 8, TILE.SAND);
  set(cells, 4, 10, TILE.WATER);
  set(cells, 9, 10, TILE.SAND);
  set(cells, 7, 4, TILE.SAND);
  seeds.push({ name: 'Minefield', layout: { cells, tee: { x: 6, y: 13 }, cup: { x: 4, y: 3 } } });
}

// 9 — The Gauntlet: sand-lined funnel into a guarded cup
{
  const cells = base();
  col(cells, 3, 3, 10, TILE.SAND);
  col(cells, 9, 3, 10, TILE.SAND);
  row(cells, 5, 4, 5, TILE.WALL); // stub guarding the cup from the left
  set(cells, 5, 11, TILE.WATER);
  set(cells, 7, 11, TILE.WATER);
  seeds.push({ name: 'The Gauntlet', layout: { cells, tee: { x: 6, y: 13 }, cup: { x: 6, y: 3 } } });
}

// ── Brute-force ace solver over the real physics ────────────────
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

const out: { name: string; layout: HoleLayout; ace: Shot }[] = [];
for (const s of seeds) {
  const ace = solveAce(s.layout);
  if (!ace) {
    console.error(`✗ NO ACE FOUND: ${s.name}`);
    continue;
  }
  const check = validateRun(s.layout, [ace]);
  if (!check.valid || check.strokes !== 1) {
    console.error(`✗ VALIDATION FAILED: ${s.name}`);
    continue;
  }
  console.error(`✓ ${s.name}: ace vel=(${ace.vel.x.toFixed(2)}, ${ace.vel.y.toFixed(2)})`);
  out.push({ name: s.name, layout: s.layout, ace });
}

console.log(JSON.stringify(out));
