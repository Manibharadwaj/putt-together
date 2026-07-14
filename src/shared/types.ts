// ── Putt Together: shared types (client + server) ──────────────

// Tile codes in a hole layout grid
export const TILE = {
  GRASS: 0,
  WALL: 1,
  SAND: 2,
  WATER: 3,
} as const;
export type TileCode = (typeof TILE)[keyof typeof TILE];

// Grid dimensions — portrait-friendly for mobile Reddit
export const GRID_COLS = 12;
export const GRID_ROWS = 16;
export const CELL = 64; // logical pixels per cell

export type Vec2 = { x: number; y: number };

// A hole as stored/transmitted. cells is row-major, GRID_COLS*GRID_ROWS long.
export type HoleLayout = {
  cells: number[];
  tee: Vec2; // grid coords (col, row) of tee center cell
  cup: Vec2; // grid coords of cup cell
};

export type Hole = {
  id: string;
  name: string;
  author: string; // reddit username
  layout: HoleLayout;
  par: number; // author's ace proof sets par reference
  createdAt: number;
  plays: number;
  aces: number;
};

// One flick: position ball started from + velocity applied.
// Physics is deterministic, so a list of shots fully reproduces a run.
export type Shot = {
  start: Vec2; // world px
  vel: Vec2; // world px/tick
};

export type HoleRecord = {
  holder: string; // reddit username
  strokes: number;
  shots: Shot[]; // ghost replay data
  setAt: number;
};

export type UserState = {
  username: string;
  tokens: number; // shots remaining today (refills daily)
  streak: number; // consecutive days played
  points: number; // creator + play points
  lastPlayedDay: string; // YYYY-MM-DD (UTC)
  completed: string[]; // hole ids finished
};

// ── API payloads ────────────────────────────────────────────────

export type WorldResponse = {
  holes: {
    id: string;
    name: string;
    author: string;
    par: number;
    plays: number;
    layout: HoleLayout; // used for the card mini-previews
    record: { holder: string; strokes: number } | null;
    completedByMe: boolean;
  }[];
  me: UserState;
};

export type HoleResponse = {
  hole: Hole;
  record: HoleRecord | null;
};

export type ShotResultRequest = {
  holeId: string;
  strokes: number;
  shots: Shot[];
};

export type ShotResultResponse = {
  newRecord: boolean;
  points: number; // points earned this run
  me: UserState;
};

export type PublishHoleRequest = {
  name: string;
  layout: HoleLayout;
  aceShots: Shot[]; // the creator's ace proof — server re-simulates? v1: trust count==1 validated client-side, server sanity checks
};

export type PublishHoleResponse = {
  ok: boolean;
  holeId?: string;
  error?: string;
};
