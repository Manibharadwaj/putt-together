// ── Deterministic golf physics ──────────────────────────────────
// Fixed-timestep, integer-friendly simulation shared by client and
// server. Given the same layout and shot list, every device produces
// the identical ball path — ghost replays and server-side validation
// both re-simulate from shot vectors alone.

import { GRID_COLS, GRID_ROWS, CELL, TILE, type HoleLayout, type Shot, type Vec2 } from './types';

export const WORLD_W = GRID_COLS * CELL; // 768
export const WORLD_H = GRID_ROWS * CELL; // 1024

export const BALL_R = 14;
export const CUP_R = 22;
export const CUP_CAPTURE_SPEED = 7.5; // max speed to drop in
export const STOP_SPEED = 0.18; // below this the ball is at rest
export const MAX_SHOT_SPEED = 34;

const FRICTION_GRASS = 0.9855;
const FRICTION_SAND = 0.913;
const FRICTION_ICE = 0.995; // barely slows — the ball sails (worst case still rests inside MAX_TICKS)
const WALL_RESTITUTION = 0.78;
export const MAX_TICKS = 60 * 20; // 20s safety cap per shot

export type SimEvent =
  | { type: 'bounce'; pos: Vec2; tick: number }
  | { type: 'water'; pos: Vec2; tick: number }
  | { type: 'sunk'; pos: Vec2; tick: number };

export type SimResult = {
  path: Vec2[]; // ball position each tick (for rendering/ghosts)
  end: Vec2; // resting position (or tee-return spot after water)
  sunk: boolean;
  water: boolean;
  events: SimEvent[];
  ticks: number;
};

export function tileAt(layout: HoleLayout, x: number, y: number): number {
  const c = Math.floor(x / CELL);
  const r = Math.floor(y / CELL);
  if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) return TILE.WALL;
  return layout.cells[r * GRID_COLS + c] ?? TILE.WALL;
}

export function cellCenter(cell: Vec2): Vec2 {
  return { x: cell.x * CELL + CELL / 2, y: cell.y * CELL + CELL / 2 };
}

function isSolid(layout: HoleLayout, x: number, y: number): boolean {
  return tileAt(layout, x, y) === TILE.WALL;
}

// Simulate ONE shot from `start` with velocity `vel` until rest/sunk/water.
export function simulateShot(layout: HoleLayout, shot: Shot): SimResult {
  const cup = cellCenter(layout.cup);
  let x = shot.start.x;
  let y = shot.start.y;
  let vx = shot.vel.x;
  let vy = shot.vel.y;

  // clamp shot power
  const sp = Math.hypot(vx, vy);
  if (sp > MAX_SHOT_SPEED) {
    vx = (vx / sp) * MAX_SHOT_SPEED;
    vy = (vy / sp) * MAX_SHOT_SPEED;
  }

  const path: Vec2[] = [{ x, y }];
  const events: SimEvent[] = [];
  let tick = 0;

  while (tick < MAX_TICKS) {
    tick++;

    // substep so fast balls never tunnel through 64px walls
    const speed = Math.hypot(vx, vy);
    const steps = Math.max(1, Math.ceil(speed / (BALL_R * 0.75)));
    let bounced = false;
    for (let s = 0; s < steps; s++) {
      const nx = x + vx / steps;
      const ny = y + vy / steps;

      // horizontal collision
      if (isSolid(layout, nx + Math.sign(vx) * BALL_R, y)) {
        vx = -vx * WALL_RESTITUTION;
        vy = vy * WALL_RESTITUTION;
        bounced = true;
      } else {
        x = nx;
      }
      // vertical collision
      if (isSolid(layout, x, ny + Math.sign(vy) * BALL_R)) {
        vy = -vy * WALL_RESTITUTION;
        vx = vx * WALL_RESTITUTION;
        bounced = true;
      } else {
        y = ny;
      }
    }
    if (bounced) events.push({ type: 'bounce', pos: { x, y }, tick });

    // surface effects
    const t = tileAt(layout, x, y);
    if (t === TILE.WATER) {
      events.push({ type: 'water', pos: { x, y }, tick });
      path.push({ x, y });
      return {
        path,
        end: { x: shot.start.x, y: shot.start.y }, // ball returns to where it was hit
        sunk: false,
        water: true,
        events,
        ticks: tick,
      };
    }
    const friction =
      t === TILE.SAND ? FRICTION_SAND : t === TILE.ICE ? FRICTION_ICE : FRICTION_GRASS;
    vx *= friction;
    vy *= friction;

    // cup capture: near cup and slow enough
    const dCup = Math.hypot(x - cup.x, y - cup.y);
    const spd = Math.hypot(vx, vy);
    if (dCup < CUP_R && spd < CUP_CAPTURE_SPEED) {
      events.push({ type: 'sunk', pos: { x: cup.x, y: cup.y }, tick });
      path.push({ x: cup.x, y: cup.y });
      return { path, end: { x: cup.x, y: cup.y }, sunk: true, water: false, events, ticks: tick };
    }
    // cup lip: rolling over the cup too fast bends the path slightly toward it
    if (dCup < CUP_R * 1.6 && spd >= CUP_CAPTURE_SPEED) {
      vx += ((cup.x - x) / dCup) * 0.55;
      vy += ((cup.y - y) / dCup) * 0.55;
    }

    path.push({ x, y });

    if (spd < STOP_SPEED) break;
  }

  return { path, end: { x, y }, sunk: false, water: false, events, ticks: tick };
}

// Re-simulate a full run (list of shots). Returns true if it legitimately
// sinks the ball, with each shot starting where the previous ended.
export function validateRun(layout: HoleLayout, shots: Shot[]): { valid: boolean; strokes: number } {
  if (shots.length === 0) return { valid: false, strokes: 0 };
  let expectedStart = cellCenter(layout.tee);
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]!;
    // shot must start where the ball actually was (small tolerance)
    if (Math.hypot(shot.start.x - expectedStart.x, shot.start.y - expectedStart.y) > 2) {
      return { valid: false, strokes: 0 };
    }
    const res = simulateShot(layout, shot);
    if (res.sunk) {
      return { valid: i === shots.length - 1, strokes: shots.length };
    }
    expectedStart = res.end;
  }
  return { valid: false, strokes: 0 }; // never sunk
}

// Basic layout sanity: tee/cup inside bounds, not on solid/water tiles,
// correct cell count, only known tile codes.
export function validateLayout(layout: HoleLayout): string | null {
  if (!Array.isArray(layout.cells) || layout.cells.length !== GRID_COLS * GRID_ROWS) {
    return 'bad grid size';
  }
  if (layout.cells.some((c) => c !== 0 && c !== 1 && c !== 2 && c !== 3 && c !== 4)) {
    return 'unknown tile code';
  }
  const inBounds = (p: Vec2) => p.x >= 0 && p.x < GRID_COLS && p.y >= 0 && p.y < GRID_ROWS;
  if (!inBounds(layout.tee) || !inBounds(layout.cup)) return 'tee/cup out of bounds';
  const at = (p: Vec2) => layout.cells[p.y * GRID_COLS + p.x];
  if (at(layout.tee) !== TILE.GRASS) return 'tee must be on grass';
  if (at(layout.cup) !== TILE.GRASS) return 'cup must be on grass';
  if (layout.tee.x === layout.cup.x && layout.tee.y === layout.cup.y) return 'tee on cup';
  return null;
}
