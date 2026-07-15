// Art direction in one place: palette, type, and drawn UI helpers.
// No emoji in UI — every icon is drawn.

import * as Phaser from 'phaser';

export const FONT = 'Lilita';

export const PALETTE = {
  // course
  grassA: 0x6abf5e,
  grassB: 0x63b657,
  fairwayDark: 0x1c4520,
  fairwayDarker: 0x16381a,
  wall: 0x4a3423,
  wallTop: 0x6b4c33,
  sand: 0xecd9a0,
  sandGrain: 0xdcc488,
  water: 0x4aa3dc,
  waterDeep: 0x357fb5,
  // ui
  cream: 0xfff8ec,
  ink: 0x2b2118,
  inkSoft: 0x7a6a58,
  accent: 0xe6503f,
  accentDark: 0xb03328,
  gold: 0xf2b010,
  goldDark: 0xc78d00,
  blue: 0x3873d6,
  green: 0x58a14e,
} as const;

export const HEX = {
  cream: '#fff8ec',
  ink: '#2b2118',
  inkSoft: '#7a6a58',
  accent: '#e6503f',
  gold: '#f2b010',
  white: '#ffffff',
  paleGreen: '#cde8c9',
} as const;

// Load the bundled display font before any scene renders text.
export async function loadFont(): Promise<void> {
  try {
    const face = new FontFace(FONT, "url('/fonts/LilitaOne-Regular.ttf')");
    await face.load();
    (document.fonts as FontFaceSet).add(face);
  } catch (e) {
    console.error('font load failed, falling back', e);
  }
}

type ButtonOpts = {
  w: number;
  h: number;
  fill: number;
  fillDark: number;
  label: string;
  size?: number;
  sub?: string;
};

// Chunky game button: rounded rect + darker "3D" base + label.
export function drawButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  opts: ButtonOpts,
  onTap: () => void
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const r = opts.h / 2.6;
  g.fillStyle(opts.fillDark);
  g.fillRoundedRect(-opts.w / 2, -opts.h / 2 + 6, opts.w, opts.h, r);
  g.fillStyle(opts.fill);
  g.fillRoundedRect(-opts.w / 2, -opts.h / 2, opts.w, opts.h - 6, r);
  c.add(g);
  const label = scene.add
    .text(0, opts.sub ? -16 : -3, opts.label, {
      fontFamily: FONT,
      fontSize: opts.size ?? 30,
      color: HEX.white,
    })
    .setOrigin(0.5);
  c.add(label);
  if (opts.sub) {
    const sub = scene.add
      .text(0, 16, opts.sub, {
        fontFamily: FONT,
        fontSize: 17,
        color: '#ffffffbb',
      })
      .setOrigin(0.5);
    c.add(sub);
  }
  c.setSize(opts.w, opts.h);
  c.setInteractive({ useHandCursor: true });
  c.on('pointerdown', () => c.setY(y + 3));
  c.on('pointerup', () => {
    c.setY(y);
    onTap();
  });
  c.on('pointerout', () => c.setY(y));
  return c;
}

// Small drawn golf flag (pole + pennant + mound).
export function drawFlag(scene: Phaser.Scene, x: number, y: number, scale = 1): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.setPosition(x, y);
  g.setScale(scale);
  // mound
  g.fillStyle(PALETTE.green);
  g.fillEllipse(0, 30, 56, 18);
  // hole
  g.fillStyle(0x1a1a1a);
  g.fillEllipse(0, 28, 26, 9);
  // pole
  g.fillStyle(0xf5f0e6);
  g.fillRect(-2, -46, 4, 74);
  // pennant
  g.fillStyle(PALETTE.accent);
  g.fillTriangle(2, -46, 2, -22, 34, -34);
  return g;
}

// Per-course visual themes. Every scene picks its colors from here.
export type ThemeName = 'meadow' | 'dunes' | 'frost' | 'forest' | 'community';
export type ThemeColors = {
  grassA: number;
  grassB: number;
  wall: number;
  wallTop: number;
  bg: number;
  header: number; // banner tint on the world map
};
export const THEMES: Record<ThemeName, ThemeColors> = {
  meadow: {
    grassA: 0x6abf5e,
    grassB: 0x63b657,
    wall: 0x4a3423,
    wallTop: 0x6b4c33,
    bg: 0x2e6b28,
    header: 0x3f8f3a,
  },
  dunes: {
    grassA: 0xc9b26a,
    grassB: 0xc2ab62,
    wall: 0x8a5a2b,
    wallTop: 0xa8743c,
    bg: 0x7a6234,
    header: 0xb08d3e,
  },
  frost: {
    grassA: 0x9fd8d4,
    grassB: 0x94cfcb,
    wall: 0x4a5d78,
    wallTop: 0x64799a,
    bg: 0x2c4a5e,
    header: 0x4a7d96,
  },
  forest: {
    grassA: 0x4e8f45,
    grassB: 0x47873e,
    wall: 0x33502c,
    wallTop: 0x466b3c,
    bg: 0x1e3d1a,
    header: 0x2f6329,
  },
  community: {
    grassA: 0x6abf5e,
    grassB: 0x63b657,
    wall: 0x4a3423,
    wallTop: 0x6b4c33,
    bg: 0x2e6b28,
    header: 0xe6503f,
  },
};

// Back chevron button (‹) drawn, top-left.
export function drawBack(scene: Phaser.Scene, onTap: () => void): Phaser.GameObjects.Container {
  const c = scene.add.container(52, 46).setDepth(30);
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.3);
  g.fillRoundedRect(-34, -26, 68, 52, 14);
  g.lineStyle(6, 0xffffff, 0.95);
  g.beginPath();
  g.moveTo(8, -12);
  g.lineTo(-8, 0);
  g.lineTo(8, 12);
  g.strokePath();
  c.add(g);
  c.setSize(68, 52).setInteractive({ useHandCursor: true });
  c.on('pointerup', onTap);
  return c;
}
