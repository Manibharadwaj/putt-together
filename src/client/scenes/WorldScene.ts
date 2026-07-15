import * as Phaser from 'phaser';
import { Scene } from 'phaser';
import type { WorldResponse } from '../../shared/types';
import { GRID_COLS, GRID_ROWS, TILE } from '../../shared/types';
import { WORLD_W, WORLD_H } from '../../shared/physics';
import { api } from '../net';
import { FONT, HEX, PALETTE, drawButton, drawFlag } from '../ui';

// The clubhouse: a scrolling list of hole cards, each with a live
// mini-render of its actual layout. Tap to play; the BUILD card at the
// end extends the course.
export class WorldScene extends Scene {
  private world: WorldResponse | null = null;
  private content!: Phaser.GameObjects.Container;
  private scrollY = 0;
  private maxScroll = 0;
  private dragMoved = 0;

  constructor() {
    super('World');
  }

  create() {
    this.cameras.main.setBackgroundColor(PALETTE.fairwayDarker);
    this.cameras.main.fadeIn(240, 10, 30, 12);
    this.drawBackground();
    this.content = this.add.container(0, 0);
    this.fitCamera();
    this.scale.on('resize', () => this.fitCamera());

    this.add
      .text(WORLD_W / 2, WORLD_H / 2, 'walking to the clubhouse…', {
        fontFamily: FONT,
        fontSize: 30,
        color: HEX.paleGreen,
      })
      .setOrigin(0.5)
      .setName('loading');

    void this.loadWorld();
    this.setupScroll();
  }

  private drawBackground() {
    // mowed-fairway stripes
    const g = this.add.graphics().setDepth(-1);
    const stripe = WORLD_H / 12;
    for (let i = 0; i < 12; i++) {
      g.fillStyle(i % 2 === 0 ? PALETTE.fairwayDarker : PALETTE.fairwayDark);
      g.fillRect(0, i * stripe, WORLD_W, stripe);
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
        .text(WORLD_W / 2, WORLD_H / 2, 'could not load — tap to retry', {
          fontFamily: FONT,
          fontSize: 28,
          color: '#ffb4a8',
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
    g.fillStyle(PALETTE.grassA);
    g.fillRoundedRect(x, y, w, h, 8);
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const t = cells[r * GRID_COLS + c];
        if (t === TILE.GRASS) continue;
        g.fillStyle(t === TILE.WALL ? PALETTE.wall : t === TILE.SAND ? PALETTE.sand : PALETTE.water);
        g.fillRect(x + c * cw, y + r * ch, cw + 0.5, ch + 0.5);
      }
    }
    return g;
  }

  private render() {
    const w = this.world!;
    this.content.removeAll(true);

    // ── header: drawn flag + wordmark ──
    const flag = drawFlag(this, WORLD_W / 2 - 205, 62, 0.9);
    const title = this.add
      .text(WORLD_W / 2 + 24, 56, 'PUTT TOGETHER', {
        fontFamily: FONT,
        fontSize: 56,
        color: HEX.cream,
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(WORLD_W / 2, 112, `${w.holes.length} holes — every one built & aced by a player`, {
        fontFamily: FONT,
        fontSize: 21,
        color: HEX.paleGreen,
      })
      .setOrigin(0.5);

    // stat chip
    const chipG = this.add.graphics();
    chipG.fillStyle(0x000000, 0.28);
    chipG.fillRoundedRect(WORLD_W / 2 - 310, 138, 620, 44, 22);
    const stats = this.add
      .text(
        WORLD_W / 2,
        160,
        `u/${w.me.username}    ${w.me.points} pts    energy ${w.me.tokens}/10    streak ${w.me.streak}`,
        { fontFamily: FONT, fontSize: 20, color: HEX.gold }
      )
      .setOrigin(0.5);
    this.content.add([flag, title, sub, chipG, stats]);

    // ── hole cards ──
    const cardW = 700;
    const cardH = 148;
    const gap = 20;
    const startY = 268;
    w.holes.forEach((h, i) => {
      const cx = WORLD_W / 2;
      const cy = startY + i * (cardH + gap);
      const done = h.completedByMe;
      const left = cx - cardW / 2;

      const cardG = this.add.graphics();
      // drop shadow
      cardG.fillStyle(0x000000, 0.28);
      cardG.fillRoundedRect(left + 4, cy - cardH / 2 + 7, cardW, cardH, 20);
      // card
      cardG.fillStyle(PALETTE.cream);
      cardG.fillRoundedRect(left, cy - cardH / 2, cardW, cardH, 20);
      // spine: done = green, fresh = gold
      cardG.fillStyle(done ? PALETTE.green : PALETTE.gold);
      cardG.fillRoundedRect(left, cy - cardH / 2, 12, cardH, { tl: 20, tr: 0, br: 0, bl: 20 });

      // tap zone
      const hit = this.add
        .rectangle(cx, cy, cardW, cardH, 0xffffff, 0.001)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => this.playHole(h.id));

      // mini layout preview
      const mini = this.miniMap(left + 28, cy - cardH / 2 + 14, h.layout.cells, 90, 120);

      const num = this.add
        .text(left + 152, cy - 40, `${i + 1}`.padStart(2, '0'), {
          fontFamily: FONT,
          fontSize: 40,
          color: done ? '#58a14e' : '#d9c9a8',
        })
        .setOrigin(0, 0.5);

      const name = this.add
        .text(left + 226, cy - 40, h.name, {
          fontFamily: FONT,
          fontSize: 32,
          color: HEX.ink,
        })
        .setOrigin(0, 0.5);
      const author = this.add
        .text(left + 152, cy + 2, `built by u/${h.author}  ·  ${h.plays} plays`, {
          fontFamily: FONT,
          fontSize: 20,
          color: HEX.inkSoft,
        })
        .setOrigin(0, 0.5);

      // record row: drawn medal dot + text
      const medal = this.add.circle(left + 162, cy + 40, 9, PALETTE.gold);
      medal.setStrokeStyle(2, PALETTE.goldDark);
      const recStr = h.record
        ? `record ${h.record.strokes} — u/${h.record.holder}`
        : 'no record yet — claim it';
      const rec = this.add
        .text(left + 182, cy + 40, recStr, {
          fontFamily: FONT,
          fontSize: 21,
          color: '#a97d0a',
        })
        .setOrigin(0, 0.5);

      // play affordance: drawn triangle / replay ring
      const affG = this.add.graphics();
      if (done) {
        affG.lineStyle(6, PALETTE.green, 1);
        affG.strokeCircle(left + cardW - 52, cy, 20);
        affG.fillStyle(PALETTE.green);
        affG.fillTriangle(left + cardW - 46, cy - 8, left + cardW - 46, cy + 8, left + cardW - 34, cy);
      } else {
        affG.fillStyle(PALETTE.accent);
        affG.fillCircle(left + cardW - 52, cy, 26);
        affG.fillStyle(0xffffff);
        affG.fillTriangle(left + cardW - 60, cy - 12, left + cardW - 60, cy + 12, left + cardW - 38, cy);
      }

      // each card slides up into place, staggered down the list
      const cardC = this.add.container(0, 36);
      cardC.add([cardG, hit, mini, num, name, author, medal, rec, affG]);
      cardC.setAlpha(0);
      this.tweens.add({
        targets: cardC,
        alpha: 1,
        y: 0,
        duration: 340,
        ease: 'Cubic.out',
        delay: 60 + Math.min(i, 8) * 55,
      });
      this.content.add(cardC);
    });

    if (w.holes.length === 0) {
      const empty = this.add
        .text(WORLD_W / 2, 400, 'The course is empty.\nBe the first to build a hole!', {
          fontFamily: FONT,
          fontSize: 32,
          color: HEX.cream,
          align: 'center',
        })
        .setOrigin(0.5);
      this.content.add(empty);
    }

    // ── build button at the end ──
    const by = startY + w.holes.length * (cardH + gap) + 40;
    const build = drawButton(
      this,
      WORLD_W / 2,
      by,
      {
        w: 700,
        h: 108,
        fill: PALETTE.accent,
        fillDark: PALETTE.accentDark,
        label: `BUILD HOLE ${w.holes.length + 1}`,
        size: 36,
        sub: 'design it — ace it — own it',
      },
      () => {
        if (this.dragMoved > 12) return;
        this.scene.start('Build');
      }
    );
    this.content.add(build);
    // heartbeat on the call-to-action
    this.tweens.add({
      targets: build,
      scale: 1.025,
      duration: 850,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

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
          holeName: hole.name,
          holeId: id,
          ghost: record,
        });
      } catch (e) {
        console.error('hole load failed', e);
      }
    })();
  }

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
