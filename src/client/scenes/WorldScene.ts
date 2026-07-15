import * as Phaser from 'phaser';
import { Scene } from 'phaser';
import type { WorldResponse, WorldHole } from '../../shared/types';
import { GRID_COLS, GRID_ROWS, TILE } from '../../shared/types';
import { WORLD_W, WORLD_H } from '../../shared/physics';
import { api } from '../net';
import { FONT, HEX, PALETTE, THEMES, drawButton, drawFlag } from '../ui';

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
        g.fillStyle(
          t === TILE.WALL
            ? PALETTE.wall
            : t === TILE.SAND
              ? PALETTE.sand
              : t === TILE.ICE
                ? 0xd6f0f5
                : PALETTE.water
        );
        g.fillRect(x + c * cw, y + r * ch, cw + 0.5, ch + 0.5);
      }
    }
    return g;
  }

  private render() {
    const w = this.world!;
    this.content.removeAll(true);
    const totalHoles = w.courses.reduce((s, c) => s + c.holes.length, 0);

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
      .text(WORLD_W / 2, 112, `${totalHoles} holes — every one built & aced by a player`, {
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
        WORLD_W / 2 - 30,
        160,
        `u/${w.me.username}    ${w.me.points} pts    energy ${w.me.tokens}/10    streak ${w.me.streak}`,
        { fontFamily: FONT, fontSize: 20, color: HEX.gold }
      )
      .setOrigin(0.5);
    // trophy button → leaderboard
    const trophy = this.add.container(WORLD_W / 2 + 275, 160);
    const tg = this.add.graphics();
    tg.fillStyle(PALETTE.gold);
    tg.fillRoundedRect(-14, -12, 28, 16, 5); // cup body
    tg.fillRect(-4, 4, 8, 8); // stem
    tg.fillRoundedRect(-12, 12, 24, 5, 2); // base
    tg.lineStyle(4, PALETTE.gold);
    tg.beginPath();
    tg.arc(-16, -6, 6, Math.PI * 0.5, Math.PI * 1.5);
    tg.strokePath();
    tg.beginPath();
    tg.arc(16, -6, 6, -Math.PI * 0.5, Math.PI * 0.5);
    tg.strokePath();
    trophy.add(tg);
    trophy.setSize(56, 48).setInteractive({ useHandCursor: true });
    trophy.on('pointerup', () => {
      if (this.dragMoved <= 12) this.showLeaderboard();
    });
    this.content.add([flag, title, sub, chipG, stats, trophy]);

    // ── themed course sections ──
    const cardW = 700;
    const cardH = 148;
    const gap = 20;
    let y = 268;
    let cardIndex = 0;

    for (const course of w.courses) {
      if (course.theme === 'community' || course.holes.length > 0 || course.locked) {
        // course banner
        const theme = THEMES[course.theme];
        const bannerG = this.add.graphics();
        bannerG.fillStyle(theme.header, course.locked ? 0.45 : 0.95);
        bannerG.fillRoundedRect(WORLD_W / 2 - cardW / 2, y - 34, cardW, 68, 18);
        const done = course.holes.filter((h) => h.completedByMe).length;
        const progress = course.locked
          ? ''
          : course.theme === 'community'
            ? `${course.holes.length} built`
            : `${done}/${course.holes.length}`;
        const bannerTitle = this.add
          .text(WORLD_W / 2 - cardW / 2 + 28, y, course.title.toUpperCase(), {
            fontFamily: FONT,
            fontSize: 30,
            color: course.locked ? '#ffffff88' : HEX.white,
          })
          .setOrigin(0, 0.5);
        const bannerRight = this.add
          .text(WORLD_W / 2 + cardW / 2 - 28, y, progress, {
            fontFamily: FONT,
            fontSize: 24,
            color: '#ffffffcc',
          })
          .setOrigin(1, 0.5);
        this.content.add([bannerG, bannerTitle, bannerRight]);

        if (course.locked) {
          // drawn padlock + unlock hint
          const lockG = this.add.graphics();
          const lx = WORLD_W / 2 + cardW / 2 - 40;
          lockG.fillStyle(0xffffff, 0.9);
          lockG.fillRoundedRect(lx - 13, y - 4, 26, 20, 5);
          lockG.lineStyle(5, 0xffffff, 0.9);
          lockG.beginPath();
          lockG.arc(lx, y - 5, 9, Math.PI, 0);
          lockG.strokePath();
          const hint = this.add
            .text(WORLD_W / 2, y + 56, course.unlockHint, {
              fontFamily: FONT,
              fontSize: 20,
              color: '#ffffff77',
            })
            .setOrigin(0.5);
          this.content.add([lockG, hint]);
          y += 130;
          continue;
        }
        y += 76;
      }

      course.holes.forEach((h, holeIdx) => {
        const i = cardIndex++;
        const cy = this.renderCard(h, holeIdx, i, y, cardW, cardH);
        void cy;
        y += cardH + gap;
      });

      if (course.theme === 'community' && course.holes.length === 0) {
        const empty = this.add
          .text(WORLD_W / 2, y + 10, 'No community holes yet.\nBe the first — build one below!', {
            fontFamily: FONT,
            fontSize: 26,
            color: HEX.paleGreen,
            align: 'center',
          })
          .setOrigin(0.5);
        this.content.add(empty);
        y += 110;
      }
    }

    // ── build button at the end ──
    const by = y + 40;
    const build = drawButton(
      this,
      WORLD_W / 2,
      by,
      {
        w: 700,
        h: 108,
        fill: PALETTE.accent,
        fillDark: PALETTE.accentDark,
        label: 'BUILD A HOLE',
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

  // renders one hole card at vertical offset `top`; returns center y
  private renderCard(
    h: WorldHole,
    holeIdx: number,
    i: number,
    top: number,
    cardW: number,
    cardH: number
  ): number {
    {
      const cy = top + cardH / 2;
      const done = h.completedByMe;
      const left = WORLD_W / 2 - cardW / 2;

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
        .rectangle(WORLD_W / 2, cy, cardW, cardH, 0xffffff, 0.001)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => this.playHole(h.id, h.theme));

      // mini layout preview
      const mini = this.miniMap(left + 28, cy - cardH / 2 + 14, h.layout.cells, 90, 120);

      const num = this.add
        .text(left + 152, cy - 40, `${holeIdx + 1}`.padStart(2, '0'), {
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
      return cy;
    }
  }

  // top-10 leaderboard overlay (fixed to camera, not the scroll list)
  private showLeaderboard() {
    void (async () => {
      let data: { rows: { username: string; points: number }[]; me: string };
      try {
        data = await api.leaderboard();
      } catch (e) {
        console.error('leaderboard failed', e);
        return;
      }
      const cx = WORLD_W / 2;
      const cy = WORLD_H / 2;
      const group: Phaser.GameObjects.GameObject[] = [];

      const dim = this.add
        .rectangle(cx, cy, WORLD_W * 2, WORLD_H * 2, 0x000000, 0.6)
        .setDepth(40)
        .setInteractive();
      const panel = this.add.graphics().setDepth(41);
      panel.fillStyle(0x000000, 0.3);
      panel.fillRoundedRect(cx - 285, cy - 335, 580, 690, 26);
      panel.fillStyle(PALETTE.cream);
      panel.fillRoundedRect(cx - 290, cy - 340, 580, 690, 26);
      panel.fillStyle(PALETTE.gold);
      panel.fillRoundedRect(cx - 290, cy - 340, 580, 84, { tl: 26, tr: 26, br: 0, bl: 0 });
      const heading = this.add
        .text(cx, cy - 298, 'TOP PUTTERS', { fontFamily: FONT, fontSize: 34, color: HEX.white })
        .setOrigin(0.5)
        .setDepth(42);
      group.push(dim, panel, heading);

      const medals = [0xf2b010, 0xb9c0c8, 0xc98a4b];
      data.rows.forEach((row, i) => {
        const ry = cy - 220 + i * 52;
        const isMe = row.username === data.me;
        if (isMe) {
          const hl = this.add.graphics().setDepth(41);
          hl.fillStyle(0xffe9b0, 0.9);
          hl.fillRoundedRect(cx - 270, ry - 22, 540, 44, 10);
          group.push(hl);
        }
        const rankColor = i < 3 ? medals[i]! : 0xd9cdb8;
        const dot = this.add.circle(cx - 240, ry, 15, rankColor).setDepth(42);
        const rank = this.add
          .text(cx - 240, ry - 1, `${i + 1}`, { fontFamily: FONT, fontSize: 18, color: '#ffffff' })
          .setOrigin(0.5)
          .setDepth(43);
        const nm = this.add
          .text(cx - 205, ry, `u/${row.username}`, {
            fontFamily: FONT,
            fontSize: 24,
            color: isMe ? '#a9720a' : '#2b2118',
          })
          .setOrigin(0, 0.5)
          .setDepth(42);
        const pts = this.add
          .text(cx + 250, ry, `${row.points}`, { fontFamily: FONT, fontSize: 24, color: '#a9720a' })
          .setOrigin(1, 0.5)
          .setDepth(42);
        group.push(dot, rank, nm, pts);
      });
      if (data.rows.length === 0) {
        group.push(
          this.add
            .text(cx, cy - 60, 'No scores yet — go putt!', {
              fontFamily: FONT,
              fontSize: 26,
              color: HEX.inkSoft,
            })
            .setOrigin(0.5)
            .setDepth(42)
        );
      }

      const close = drawButton(
        this,
        cx,
        cy + 290,
        { w: 240, h: 70, fill: PALETTE.accent, fillDark: PALETTE.accentDark, label: 'CLOSE', size: 26 },
        () => group.forEach((o) => o.destroy())
      ).setDepth(43);
      group.push(close);
      dim.on('pointerup', () => group.forEach((o) => o.destroy()));
    })();
  }

  private playHole(id: string, theme: WorldHole['theme']) {
    if (this.dragMoved > 12) return; // it was a scroll, not a tap
    void (async () => {
      try {
        const { hole, record } = await api.hole(id);
        this.scene.start('Play', {
          layout: hole.layout,
          holeName: hole.name,
          holeId: id,
          ghost: record,
          theme,
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
