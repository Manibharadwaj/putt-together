import * as Phaser from 'phaser';
import { Scene } from 'phaser';
import type { WorldResponse } from '../../shared/types';
import { GRID_COLS, GRID_ROWS, TILE } from '../../shared/types';
import { WORLD_W, WORLD_H } from '../../shared/physics';
import { api } from '../net';

// The clubhouse: a scrolling list of hole cards, each with a live
// mini-render of its actual layout. Tap to play; the BUILD card at the
// end extends the course.
export class WorldScene extends Scene {
  private world: WorldResponse | null = null;
  private content!: Phaser.GameObjects.Container;
  private scrollY = 0;
  private maxScroll = 0;

  constructor() {
    super('World');
  }

  create() {
    this.cameras.main.setBackgroundColor(0x1d4a18);
    this.drawBackground();
    this.content = this.add.container(0, 0);
    this.fitCamera();
    this.scale.on('resize', () => this.fitCamera());

    this.add
      .text(WORLD_W / 2, WORLD_H / 2, 'Loading the course…', {
        fontFamily: 'Arial Black',
        fontSize: 34,
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setName('loading');

    void this.loadWorld();
    this.setupScroll();
  }

  private drawBackground() {
    // subtle mowed-fairway stripes
    const g = this.add.graphics().setDepth(-1);
    for (let i = 0; i < 10; i++) {
      g.fillStyle(i % 2 === 0 ? 0x1d4a18 : 0x215420);
      g.fillRect(0, (i * WORLD_H) / 10, WORLD_W, WORLD_H / 10);
    }
  }

  private fitCamera() {
    const { width, height } = this.scale;
    const zoom = Math.min(width / WORLD_W, height / WORLD_H);
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(WORLD_W / 2, WORLD_H / 2);
  }

  private async loadWorld() {
    try {
      this.world = await api.world();
    } catch (e) {
      console.error('world load failed', e);
      this.children.getByName('loading')?.destroy();
      this.add
        .text(WORLD_W / 2, WORLD_H / 2, 'Could not load — tap to retry', {
          fontFamily: 'Arial Black',
          fontSize: 30,
          color: '#ffcccc',
        })
        .setOrigin(0.5)
        .setInteractive()
        .once('pointerdown', () => this.scene.restart());
      return;
    }
    this.children.getByName('loading')?.destroy();
    this.render();
  }

  // tiny top-down render of a hole layout
  private miniMap(x: number, y: number, cells: number[], w: number, h: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    const cw = w / GRID_COLS;
    const ch = h / GRID_ROWS;
    g.fillStyle(0x58b64c);
    g.fillRoundedRect(x, y, w, h, 6);
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const t = cells[r * GRID_COLS + c];
        if (t === TILE.GRASS) continue;
        g.fillStyle(t === TILE.WALL ? 0x3d2c1e : t === TILE.SAND ? 0xe8d08a : 0x3f9bd8);
        g.fillRect(x + c * cw, y + r * ch, cw + 0.5, ch + 0.5);
      }
    }
    return g;
  }

  private render() {
    const w = this.world!;
    this.content.removeAll(true);

    // ── header ──
    const title = this.add
      .text(WORLD_W / 2, 58, '⛳ PUTT TOGETHER', {
        fontFamily: 'Arial Black',
        fontSize: 54,
        color: '#ffffff',
        stroke: '#00000066',
        strokeThickness: 8,
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(WORLD_W / 2, 110, `${w.holes.length} holes · every one built & aced by a player`, {
        fontFamily: 'Arial',
        fontSize: 23,
        color: '#c8e6c9',
      })
      .setOrigin(0.5);
    const statBg = this.add
      .rectangle(WORLD_W / 2, 158, 620, 46, 0x000000, 0.25)
      .setStrokeStyle(2, 0xffffff, 0.15);
    const stats = this.add
      .text(
        WORLD_W / 2,
        158,
        `u/${w.me.username}   ·   ${w.me.points} pts   ·   ⚡ ${w.me.tokens}   ·   🔥 ${w.me.streak}`,
        { fontFamily: 'Arial Black', fontSize: 22, color: '#ffd700' }
      )
      .setOrigin(0.5);
    this.content.add([title, sub, statBg, stats]);

    // ── hole cards ──
    const cardW = 700;
    const cardH = 148;
    const gap = 18;
    const startY = 230;
    w.holes.forEach((h, i) => {
      const cx = WORLD_W / 2;
      const cy = startY + i * (cardH + gap);
      const done = h.completedByMe;

      const card = this.add
        .rectangle(cx, cy, cardW, cardH, 0xffffff, 0.97)
        .setStrokeStyle(4, done ? 0x66bb6a : 0xffffff, done ? 1 : 0.25);
      card.setInteractive({ useHandCursor: true }).on('pointerup', () => this.playHole(h.id));

      // mini layout preview (left side of card)
      const mini = this.miniMap(cx - cardW / 2 + 16, cy - cardH / 2 + 14, h.layout.cells, 90, 120);

      // number badge
      const badge = this.add.circle(cx - cardW / 2 + 152, cy - 28, 26, done ? 0x66bb6a : 0x2d6cdf);
      const num = this.add
        .text(cx - cardW / 2 + 152, cy - 30, `${i + 1}`, {
          fontFamily: 'Arial Black',
          fontSize: 26,
          color: '#ffffff',
        })
        .setOrigin(0.5);

      const name = this.add
        .text(cx - cardW / 2 + 196, cy - 44, h.name, {
          fontFamily: 'Arial Black',
          fontSize: 30,
          color: '#222222',
        })
        .setOrigin(0, 0.5);
      const author = this.add
        .text(cx - cardW / 2 + 196, cy - 10, `built by u/${h.author} · ${h.plays} plays`, {
          fontFamily: 'Arial',
          fontSize: 20,
          color: '#777777',
        })
        .setOrigin(0, 0.5);
      const recStr = h.record
        ? `🏆 record: ${h.record.strokes} stroke${h.record.strokes === 1 ? '' : 's'} — u/${h.record.holder}`
        : '🏆 no record yet — claim it';
      const rec = this.add
        .text(cx - cardW / 2 + 196, cy + 26, recStr, {
          fontFamily: 'Arial Black',
          fontSize: 20,
          color: '#b8860b',
        })
        .setOrigin(0, 0.5);

      const play = this.add
        .text(cx + cardW / 2 - 30, cy, done ? '↻' : '▶', {
          fontFamily: 'Arial Black',
          fontSize: 40,
          color: done ? '#66bb6a' : '#e63946',
        })
        .setOrigin(0.5);

      this.content.add([card, mini, badge, num, name, author, rec, play]);
    });

    if (w.holes.length === 0) {
      const empty = this.add
        .text(WORLD_W / 2, 380, 'The course is empty.\nBe the first to build a hole! 👇', {
          fontFamily: 'Arial Black',
          fontSize: 32,
          color: '#ffffff',
          align: 'center',
        })
        .setOrigin(0.5);
      this.content.add(empty);
    }

    // ── build card at the end ──
    const by = startY + w.holes.length * (cardH + gap) + 30;
    const buildBg = this.add
      .rectangle(WORLD_W / 2, by, 700, 110, 0xe63946)
      .setStrokeStyle(5, 0xffffff);
    const buildTxt = this.add
      .text(WORLD_W / 2, by - 14, '🔨 BUILD HOLE ' + (w.holes.length + 1), {
        fontFamily: 'Arial Black',
        fontSize: 34,
        color: '#ffffff',
      })
      .setOrigin(0.5);
    const buildSub = this.add
      .text(WORLD_W / 2, by + 26, 'design it · ace it · own it', {
        fontFamily: 'Arial',
        fontSize: 20,
        color: '#ffd7d7',
      })
      .setOrigin(0.5);
    buildBg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
      this.scene.start('Build');
    });
    this.content.add([buildBg, buildTxt, buildSub]);

    this.maxScroll = Math.max(0, by + 130 - WORLD_H);
    this.applyScroll();
  }

  private playHole(id: string) {
    if (this.dragMoved > 12) return; // it was a scroll, not a tap
    void (async () => {
      try {
        const { hole, record } = await api.hole(id);
        this.scene.start('Play', {
          layout: hole.layout,
          holeName: `#${id} ${hole.name}`,
          holeId: id,
          ghost: record,
        });
      } catch (e) {
        console.error('hole load failed', e);
      }
    })();
  }

  private dragMoved = 0;

  private setupScroll() {
    let dragging = false;
    let lastY = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      dragging = true;
      lastY = p.y;
      this.dragMoved = 0;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      const dy = (p.y - lastY) / this.cameras.main.zoom;
      this.dragMoved += Math.abs(dy);
      lastY = p.y;
      this.scrollY = Phaser.Math.Clamp(this.scrollY - dy, 0, this.maxScroll);
      this.applyScroll();
    });
    this.input.on('pointerup', () => {
      dragging = false;
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.scrollY = Phaser.Math.Clamp(this.scrollY + dy * 0.6, 0, this.maxScroll);
      this.applyScroll();
    });
  }

  private applyScroll() {
    this.content.y = -this.scrollY;
  }
}
