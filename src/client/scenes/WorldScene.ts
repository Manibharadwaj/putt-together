import * as Phaser from 'phaser';
import { Scene } from 'phaser';
import type { WorldResponse } from '../../shared/types';
import { WORLD_W, WORLD_H } from '../../shared/physics';
import { api } from '../net';

// The course map: every hole in the world chain as a stop on a winding
// path. Tap a hole to play it; the BUILD button appends a new stop.
export class WorldScene extends Scene {
  private world: WorldResponse | null = null;
  private content!: Phaser.GameObjects.Container;
  private scrollY = 0;
  private maxScroll = 0;

  constructor() {
    super('World');
  }

  create() {
    this.cameras.main.setBackgroundColor(0x24541f);
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

  private render() {
    const w = this.world!;
    this.content.removeAll(true);

    // header
    const title = this.add
      .text(WORLD_W / 2, 60, '⛳ PUTT TOGETHER', {
        fontFamily: 'Arial Black',
        fontSize: 52,
        color: '#ffffff',
        stroke: '#00000066',
        strokeThickness: 8,
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(WORLD_W / 2, 112, `a course built by everyone · ${w.holes.length} holes`, {
        fontFamily: 'Arial',
        fontSize: 24,
        color: '#c8e6c9',
      })
      .setOrigin(0.5);
    const stats = this.add
      .text(
        WORLD_W / 2,
        150,
        `u/${w.me.username} · ${w.me.points} pts · ⚡ ${w.me.tokens} energy · 🔥 ${w.me.streak} streak`,
        { fontFamily: 'Arial', fontSize: 22, color: '#ffd700' }
      )
      .setOrigin(0.5);
    this.content.add([title, sub, stats]);

    // winding path of hole stops
    const startY = 230;
    const stepY = 130;
    w.holes.forEach((h, i) => {
      const x = WORLD_W / 2 + Math.sin(i * 1.1) * 200;
      const y = startY + i * stepY;

      // path segment to previous stop
      if (i > 0) {
        const px = WORLD_W / 2 + Math.sin((i - 1) * 1.1) * 200;
        const py = startY + (i - 1) * stepY;
        const g = this.add.graphics();
        g.lineStyle(10, 0x8bc34a, 0.5);
        const mx = (px + x) / 2;
        g.beginPath();
        g.moveTo(px, py);
        // slight curve through midpoint
        g.lineTo(mx, (py + y) / 2);
        g.lineTo(x, y);
        g.strokePath();
        this.content.add(g);
      }

      const done = h.completedByMe;
      const disc = this.add.circle(x, y, 46, done ? 0x66bb6a : 0xffffff);
      disc.setStrokeStyle(6, done ? 0x2e7d32 : 0x8d6e63);
      const num = this.add
        .text(x, y - 4, `${i + 1}`, {
          fontFamily: 'Arial Black',
          fontSize: 34,
          color: done ? '#ffffff' : '#3d2c1e',
        })
        .setOrigin(0.5);
      const label = this.add
        .text(x, y + 62, h.name, {
          fontFamily: 'Arial Black',
          fontSize: 20,
          color: '#ffffff',
          stroke: '#00000088',
          strokeThickness: 4,
        })
        .setOrigin(0.5);
      const recTxt = h.record
        ? `⏱ ${h.record.strokes} by u/${h.record.holder}`
        : 'no record yet';
      const rec = this.add
        .text(x, y + 88, `${recTxt} · by u/${h.author}`, {
          fontFamily: 'Arial',
          fontSize: 16,
          color: '#c8e6c9',
        })
        .setOrigin(0.5);

      disc.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.playHole(h.id));
      this.content.add([disc, num, label, rec]);
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

    // BUILD button pinned at the end of the path
    const by = startY + w.holes.length * stepY + 40;
    const buildBg = this.add
      .rectangle(WORLD_W / 2, by, 420, 90, 0xe63946)
      .setStrokeStyle(5, 0xffffff);
    const buildTxt = this.add
      .text(WORLD_W / 2, by, '🔨 BUILD THE NEXT HOLE', {
        fontFamily: 'Arial Black',
        fontSize: 28,
        color: '#ffffff',
      })
      .setOrigin(0.5);
    buildBg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      this.scene.start('Build');
    });
    this.content.add([buildBg, buildTxt]);

    this.maxScroll = Math.max(0, by + 120 - WORLD_H);
    this.applyScroll();
  }

  private playHole(id: string) {
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

  private setupScroll() {
    let dragging = false;
    let lastY = 0;
    let moved = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      dragging = true;
      lastY = p.y;
      moved = 0;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      const dy = (p.y - lastY) / this.cameras.main.zoom;
      moved += Math.abs(dy);
      lastY = p.y;
      this.scrollY = Phaser.Math.Clamp(this.scrollY - dy, 0, this.maxScroll);
      this.applyScroll();
    });
    this.input.on('pointerup', () => {
      dragging = false;
    });
    this.input.on(
      'wheel',
      (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        this.scrollY = Phaser.Math.Clamp(this.scrollY + dy * 0.6, 0, this.maxScroll);
        this.applyScroll();
      }
    );
  }

  private applyScroll() {
    this.content.y = -this.scrollY;
  }
}
