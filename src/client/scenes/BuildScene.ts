import * as Phaser from 'phaser';
import { Scene } from 'phaser';
import {
  GRID_COLS,
  GRID_ROWS,
  CELL,
  TILE,
  type HoleLayout,
  type Shot,
  type Vec2,
} from '../../shared/types';
import { WORLD_W, WORLD_H, validateLayout, cellCenter, BALL_R, CUP_R } from '../../shared/physics';
import { api } from '../net';
import { FONT, HEX, PALETTE, drawButton, drawBack } from '../ui';
import { sfx } from '../sound';

type Tool = 'wall' | 'sand' | 'water' | 'erase' | 'tee' | 'cup';

export type BuildSceneData = {
  layout?: HoleLayout; // returning from a test run
  aceProof?: Shot[]; // set when the test run was an ace
};

const UI_H = 190; // bottom bar height in world px
const BOARD_SCALE = (WORLD_H - UI_H) / WORLD_H;

function emptyLayout(): HoleLayout {
  const cells = new Array(GRID_COLS * GRID_ROWS).fill(TILE.GRASS);
  const set = (c: number, r: number, t: number) => (cells[r * GRID_COLS + c] = t);
  for (let c = 0; c < GRID_COLS; c++) {
    set(c, 0, TILE.WALL);
    set(c, GRID_ROWS - 1, TILE.WALL);
  }
  for (let r = 0; r < GRID_ROWS; r++) {
    set(0, r, TILE.WALL);
    set(GRID_COLS - 1, r, TILE.WALL);
  }
  return { cells, tee: { x: GRID_COLS >> 1, y: GRID_ROWS - 3 }, cup: { x: GRID_COLS >> 1, y: 2 } };
}

export class BuildScene extends Scene {
  private layout!: HoleLayout;
  private aceProof: Shot[] | null = null;
  private tool: Tool = 'wall';
  private board!: Phaser.GameObjects.Container;
  private boardG!: Phaser.GameObjects.Graphics;
  private toolButtons: Map<Tool, Phaser.GameObjects.Rectangle> = new Map();
  private publishBtn!: Phaser.GameObjects.Container;
  private statusTxt!: Phaser.GameObjects.Text;
  private painting = false;

  constructor() {
    super('Build');
  }

  init(data: BuildSceneData) {
    this.layout = data.layout ?? emptyLayout();
    this.aceProof = data.aceProof ?? null;
    this.tool = 'wall';
    this.painting = false;
    this.toolButtons.clear();
  }

  create() {
    this.cameras.main.setBackgroundColor(0x1e4519);
    this.fitCamera();
    this.scale.on('resize', () => this.fitCamera());

    // board (scaled down to leave room for the toolbar)
    this.board = this.add.container(
      (WORLD_W - WORLD_W * BOARD_SCALE) / 2,
      0
    );
    this.board.setScale(BOARD_SCALE);
    this.boardG = this.add.graphics();
    this.board.add(this.boardG);
    this.redraw();

    this.buildToolbar();
    this.setupPainting();

    this.statusTxt = this.add
      .text(WORLD_W / 2, WORLD_H - UI_H - 26, '', {
        fontFamily: FONT,
        fontSize: 22,
        color: HEX.gold,
        stroke: '#000000',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(10);

    if (this.aceProof) {
      this.statusTxt.setText('ACED! Your hole is ready to publish.');
    } else {
      this.statusTxt.setText('Design your hole, then ace it to publish.');
    }
  }

  private fitCamera() {
    const { width, height } = this.scale;
    const zoom = Math.min(width / WORLD_W, height / WORLD_H);
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(WORLD_W / 2, WORLD_H / 2);
  }

  private redraw() {
    const g = this.boardG;
    g.clear();
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const t = this.layout.cells[r * GRID_COLS + c];
        const x = c * CELL;
        const y = r * CELL;
        g.fillStyle((c + r) % 2 === 0 ? 0x58b64c : 0x51ab46);
        g.fillRect(x, y, CELL, CELL);
        if (t === TILE.WALL) {
          g.fillStyle(0x3d2c1e);
          g.fillRect(x, y, CELL, CELL);
          g.fillStyle(0x5a4430);
          g.fillRect(x + 3, y + 3, CELL - 6, CELL - 10);
        } else if (t === TILE.SAND) {
          g.fillStyle(0xe8d08a);
          g.fillRoundedRect(x + 2, y + 2, CELL - 4, CELL - 4, 10);
        } else if (t === TILE.WATER) {
          g.fillStyle(0x2f7fb8);
          g.fillRect(x, y, CELL, CELL);
          g.fillStyle(0x3f9bd8);
          g.fillRoundedRect(x + 3, y + 3, CELL - 6, CELL - 6, 8);
        }
        // faint grid lines
        g.lineStyle(1, 0x000000, 0.06);
        g.strokeRect(x, y, CELL, CELL);
      }
    }
    // tee & cup markers
    const tee = cellCenter(this.layout.tee);
    g.fillStyle(0xffffff, 0.95);
    g.fillCircle(tee.x, tee.y, BALL_R);
    g.lineStyle(3, 0xffffff, 0.5);
    g.strokeCircle(tee.x, tee.y, BALL_R + 8);
    const cup = cellCenter(this.layout.cup);
    g.fillStyle(0x1a1a1a);
    g.fillCircle(cup.x, cup.y, CUP_R);
    g.lineStyle(4, 0xf5f5f5);
    g.lineBetween(cup.x, cup.y, cup.x, cup.y - 50);
    g.fillStyle(0xe63946);
    g.fillTriangle(cup.x, cup.y - 50, cup.x, cup.y - 30, cup.x + 30, cup.y - 40);
  }

  private buildToolbar() {
    const tools: { key: Tool; label: string }[] = [
      { key: 'wall', label: 'WALL' },
      { key: 'sand', label: 'SAND' },
      { key: 'water', label: 'WATER' },
      { key: 'erase', label: 'GRASS' },
      { key: 'tee', label: 'TEE' },
      { key: 'cup', label: 'CUP' },
    ];
    const y = WORLD_H - UI_H + 46;
    const w = 100;
    const startX = (WORLD_W - tools.length * (w + 14)) / 2 + w / 2;
    tools.forEach((t, i) => {
      const x = startX + i * (w + 14);
      // frame (selection state drawn in selectTool)
      const btn = this.add.rectangle(x, y, w, 84, 0x000000, 0.28);
      btn.setStrokeStyle(4, 0xffffff, 0.25);
      // swatch: a mini-preview of the actual tile art
      const sw = this.add.graphics();
      this.drawSwatch(sw, x, y - 12, t.key);
      const label = this.add
        .text(x, y + 27, t.label, { fontFamily: FONT, fontSize: 18, color: HEX.cream })
        .setOrigin(0.5);
      btn.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        sfx.click();
        this.selectTool(t.key);
      });
      label.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.selectTool(t.key));
      this.toolButtons.set(t.key, btn);
    });
    this.selectTool('wall');

    // action buttons
    const ay = WORLD_H - UI_H + 138;
    drawButton(
      this,
      WORLD_W / 2 - 180,
      ay,
      { w: 320, h: 72, fill: PALETTE.blue, fillDark: 0x24509e, label: 'TEST & ACE', size: 27 },
      () => this.testRun()
    );
    this.publishBtn = drawButton(
      this,
      WORLD_W / 2 + 180,
      ay,
      { w: 300, h: 72, fill: PALETTE.accent, fillDark: PALETTE.accentDark, label: 'PUBLISH', size: 27 },
      () => this.publish()
    );
    this.publishBtn.setAlpha(this.aceProof ? 1 : 0.45);

    drawBack(this, () => this.scene.start('World'));
  }

  // mini-preview of the actual tile art used on the course
  private drawSwatch(g: Phaser.GameObjects.Graphics, x: number, y: number, tool: Tool) {
    const s = 44;
    const l = x - s / 2;
    const t = y - s / 2;
    if (tool === 'wall') {
      g.fillStyle(PALETTE.wall);
      g.fillRoundedRect(l, t, s, s, 6);
      g.fillStyle(PALETTE.wallTop);
      g.fillRoundedRect(l + 3, t + 3, s - 6, s - 10, 5);
    } else if (tool === 'sand') {
      g.fillStyle(PALETTE.sand);
      g.fillRoundedRect(l, t, s, s, 10);
      g.fillStyle(PALETTE.sandGrain);
      g.fillCircle(l + 12, t + 14, 2.5);
      g.fillCircle(l + 28, t + 22, 2.5);
      g.fillCircle(l + 18, t + 32, 2.5);
    } else if (tool === 'water') {
      g.fillStyle(PALETTE.waterDeep);
      g.fillRoundedRect(l, t, s, s, 6);
      g.fillStyle(PALETTE.water);
      g.fillRoundedRect(l + 3, t + 3, s - 6, s - 6, 5);
      g.lineStyle(2.5, 0xd9f0ff, 0.8);
      g.beginPath();
      g.moveTo(l + 8, t + 18);
      g.lineTo(l + 16, t + 14);
      g.lineTo(l + 24, t + 18);
      g.lineTo(l + 32, t + 14);
      g.strokePath();
    } else if (tool === 'erase') {
      g.fillStyle(PALETTE.grassA);
      g.fillRoundedRect(l, t, s / 2, s, { tl: 6, tr: 0, br: 0, bl: 6 });
      g.fillStyle(PALETTE.grassB);
      g.fillRoundedRect(l + s / 2, t, s / 2, s, { tl: 0, tr: 6, br: 6, bl: 0 });
    } else if (tool === 'tee') {
      g.fillStyle(PALETTE.grassB);
      g.fillRoundedRect(l, t, s, s, 6);
      g.fillStyle(0xffffff);
      g.fillCircle(x, y, 10);
      g.lineStyle(2, 0xffffff, 0.5);
      g.strokeCircle(x, y, 16);
    } else {
      g.fillStyle(PALETTE.grassB);
      g.fillRoundedRect(l, t, s, s, 6);
      g.fillStyle(0x1a1a1a);
      g.fillCircle(x, y + 6, 9);
      g.fillStyle(0xf5f0e6);
      g.fillRect(x - 1, y - 18, 2.5, 24);
      g.fillStyle(PALETTE.accent);
      g.fillTriangle(x + 1, y - 18, x + 1, y - 8, x + 13, y - 13);
    }
  }

  private selectTool(t: Tool) {
    this.tool = t;
    for (const [key, btn] of this.toolButtons) {
      btn.setStrokeStyle(key === t ? 6 : 4, 0xffffff, key === t ? 1 : 0.35);
    }
  }

  private setupPainting() {
    const toCell = (p: Phaser.Input.Pointer): Vec2 | null => {
      const bx = (p.worldX - this.board.x) / BOARD_SCALE;
      const by = (p.worldY - this.board.y) / BOARD_SCALE;
      const c = Math.floor(bx / CELL);
      const r = Math.floor(by / CELL);
      // inner cells only — the border wall is permanent
      if (c < 1 || c >= GRID_COLS - 1 || r < 1 || r >= GRID_ROWS - 1) return null;
      return { x: c, y: r };
    };

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const cell = toCell(p);
      if (!cell) return;
      this.painting = true;
      this.applyTool(cell);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.painting) return;
      const cell = toCell(p);
      if (!cell) return;
      if (this.tool === 'tee' || this.tool === 'cup') return; // place on tap only
      this.applyTool(cell);
    });
    this.input.on('pointerup', () => {
      this.painting = false;
    });
  }

  private applyTool(cell: Vec2) {
    const idx = cell.y * GRID_COLS + cell.x;
    const isTee = this.layout.tee.x === cell.x && this.layout.tee.y === cell.y;
    const isCup = this.layout.cup.x === cell.x && this.layout.cup.y === cell.y;

    if (this.tool === 'tee') {
      if (this.layout.cells[idx] !== TILE.GRASS || isCup) return;
      this.layout.tee = cell;
    } else if (this.tool === 'cup') {
      if (this.layout.cells[idx] !== TILE.GRASS || isTee) return;
      this.layout.cup = cell;
    } else {
      if (isTee || isCup) return; // never bury tee/cup
      const code =
        this.tool === 'wall'
          ? TILE.WALL
          : this.tool === 'sand'
            ? TILE.SAND
            : this.tool === 'water'
              ? TILE.WATER
              : TILE.GRASS;
      if (this.layout.cells[idx] === code) return;
      this.layout.cells[idx] = code;
    }
    // any edit invalidates a previous ace proof
    if (this.aceProof) {
      this.aceProof = null;
      this.publishBtn.setAlpha(0.45);
      this.statusTxt.setText('Layout changed — ace it again to publish.');
    }
    this.redraw();
  }

  private testRun() {
    const err = validateLayout(this.layout);
    if (err) {
      this.statusTxt.setText(err);
      return;
    }
    const layout: HoleLayout = {
      cells: [...this.layout.cells],
      tee: { ...this.layout.tee },
      cup: { ...this.layout.cup },
    };
    this.scene.start('Play', {
      layout,
      holeName: 'Your hole (test)',
      onFinished: (strokes: number, shots: Shot[]) => {
        const data: BuildSceneData = { layout };
        if (strokes === 1) data.aceProof = shots;
        this.scene.start('Build', data);
      },
    });
  }

  private publish() {
    if (!this.aceProof) {
      this.statusTxt.setText('Ace your own hole first — that proves it can be beaten!');
      return;
    }
    const name = this.pickName();
    this.statusTxt.setText('Publishing…');
    void (async () => {
      try {
        const res = await api.publishHole({
          name,
          layout: this.layout,
          aceShots: this.aceProof!,
        });
        if (res.ok) {
          this.scene.start('World');
        } else {
          this.statusTxt.setText(res.error ?? 'publish failed');
        }
      } catch (e) {
        console.error('publish failed', e);
        this.statusTxt.setText('publish failed — try again');
      }
    })();
  }

  // window.prompt is unreliable inside the Reddit webview → generate a
  // fun two-word name; creators identify holes by number + author anyway.
  private pickName(): string {
    const a = ['Sneaky', 'Twisted', 'Cursed', 'Cozy', 'Wild', 'Tiny', 'Mighty', 'Loopy', 'Rowdy', 'Slick'];
    const b = ['Bend', 'Gauntlet', 'Oasis', 'Trap', 'Alley', 'Dunes', 'Lagoon', 'Maze', 'Ramp', 'Corner'];
    const idx = this.layout.cells.reduce((s, v, i) => s + v * (i + 1), 0);
    return `${a[idx % a.length]} ${b[(idx >> 3) % b.length]}`;
  }
}
