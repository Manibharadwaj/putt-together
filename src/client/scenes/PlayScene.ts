import * as Phaser from 'phaser';
import { Scene } from 'phaser';
import {
  GRID_COLS,
  GRID_ROWS,
  CELL,
  TILE,
  type HoleLayout,
  type HoleRecord,
  type Shot,
  type Vec2,
} from '../../shared/types';
import { api } from '../net';
import { sfx } from '../sound';
import {
  WORLD_W,
  WORLD_H,
  BALL_R,
  CUP_R,
  MAX_SHOT_SPEED,
  simulateShot,
  cellCenter,
  type SimResult,
} from '../../shared/physics';

const COLORS = {
  grassA: 0x58b64c,
  grassB: 0x51ab46,
  wall: 0x3d2c1e,
  wallTop: 0x5a4430,
  sand: 0xe8d08a,
  water: 0x3f9bd8,
  waterDeep: 0x2f7fb8,
  ball: 0xffffff,
  cup: 0x1a1a1a,
  aim: 0xffffff,
};

export type PlaySceneData = {
  layout?: HoleLayout;
  holeName?: string;
  holeId?: string; // when set, results are submitted to the server
  ghost?: HoleRecord | null; // record holder's run, replayed as a ghost
  onFinished?: (strokes: number, shots: Shot[]) => void;
};

// A built-in test hole used until the world/editor feeds real ones.
export function testHole(): HoleLayout {
  const cells = new Array(GRID_COLS * GRID_ROWS).fill(TILE.GRASS);
  const set = (c: number, r: number, t: number) => (cells[r * GRID_COLS + c] = t);
  // border walls
  for (let c = 0; c < GRID_COLS; c++) {
    set(c, 0, TILE.WALL);
    set(c, GRID_ROWS - 1, TILE.WALL);
  }
  for (let r = 0; r < GRID_ROWS; r++) {
    set(0, r, TILE.WALL);
    set(GRID_COLS - 1, r, TILE.WALL);
  }
  // a wall jutting in, sand patch, water pool
  for (let c = 1; c <= 7; c++) set(c, 6, TILE.WALL);
  for (let c = 4; c <= 10; c++) set(c, 10, TILE.WALL);
  set(8, 3, TILE.SAND);
  set(9, 3, TILE.SAND);
  set(8, 4, TILE.SAND);
  set(9, 4, TILE.SAND);
  set(2, 12, TILE.WATER);
  set(3, 12, TILE.WATER);
  set(2, 13, TILE.WATER);
  set(3, 13, TILE.WATER);
  return { cells, tee: { x: 5, y: 13 }, cup: { x: 2, y: 3 } };
}

export class PlayScene extends Scene {
  private layout!: HoleLayout;
  private holeName = 'Test Hole';
  private holeId: string | undefined;
  private ghost: HoleRecord | null = null;
  private ghostBall: Phaser.GameObjects.Container | null = null;
  private ghostPath: Vec2[] = [];
  private ghostIndex = 0;
  private ghostRunning = false;
  private onFinished: ((strokes: number, shots: Shot[]) => void) | undefined;

  private ball!: Phaser.GameObjects.Container;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private aimG!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private strokes = 0;
  private shots: Shot[] = [];

  private ballPos: Vec2 = { x: 0, y: 0 };
  private rolling = false;
  private sunk = false;
  private sim: SimResult | null = null;
  private simIndex = 0;
  private aiming = false;
  private dragStart: Vec2 = { x: 0, y: 0 };
  private dragNow: Vec2 = { x: 0, y: 0 };

  constructor() {
    super('Play');
  }

  init(data: PlaySceneData) {
    this.layout = data.layout ?? testHole();
    this.holeName = data.holeName ?? 'Test Hole';
    this.holeId = data.holeId;
    this.ghost = data.ghost ?? null;
    this.onFinished = data.onFinished;
    this.strokes = 0;
    this.shots = [];
    this.rolling = false;
    this.sunk = false;
    this.sim = null;
    this.ghostBall = null;
    this.ghostPath = [];
    this.ghostIndex = 0;
    this.ghostRunning = false;
  }

  create() {
    const cam = this.cameras.main;
    cam.setBackgroundColor(0x2e6b28);
    this.drawCourse();

    this.ballPos = cellCenter(this.layout.tee);
    this.ballShadow = this.add
      .ellipse(this.ballPos.x + 3, this.ballPos.y + 5, BALL_R * 2, BALL_R * 1.5, 0x000000, 0.25)
      .setDepth(4);
    this.ball = this.makeBall().setDepth(5);
    this.aimG = this.add.graphics().setDepth(6);

    this.hud = this.add
      .text(WORLD_W / 2, 34, '', {
        fontFamily: 'Arial Black',
        fontSize: 30,
        color: '#ffffff',
        stroke: '#00000088',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(10);
    this.updateHud();

    this.fitCamera();
    this.scale.on('resize', () => this.fitCamera());
    this.setupInput();
    this.setupGhost();

    if (this.holeId) {
      const back = this.add
        .text(16, 18, '‹ course', {
          fontFamily: 'Arial Black',
          fontSize: 26,
          color: '#ffffff',
          backgroundColor: '#00000055',
          padding: { x: 14, y: 8 } as Phaser.Types.GameObjects.Text.TextPadding,
        })
        .setDepth(10)
        .setInteractive({ useHandCursor: true });
      back.on('pointerdown', () => this.scene.start('World'));
    }
  }

  // Pre-simulate the record run into one continuous path with pauses
  // between shots; the ghost races you from your first flick.
  private setupGhost() {
    if (!this.ghost || this.ghost.shots.length === 0) return;
    const PAUSE = 26; // ticks between ghost shots
    for (const s of this.ghost.shots) {
      const res = simulateShot(this.layout, s);
      this.ghostPath.push(...res.path);
      const last = res.path[res.path.length - 1]!;
      for (let i = 0; i < PAUSE; i++) this.ghostPath.push(last);
    }
    const start = this.ghostPath[0]!;
    const c = this.add.container(start.x, start.y).setDepth(3).setAlpha(0.45);
    const body = this.add.circle(0, 0, BALL_R, 0xbfe3ff);
    body.setStrokeStyle(2, 0x8ab8dd);
    const tag = this.add
      .text(0, -BALL_R - 16, `u/${this.ghost.holder} · ${this.ghost.strokes}`, {
        fontFamily: 'Arial',
        fontSize: 16,
        color: '#dbefff',
      })
      .setOrigin(0.5);
    c.add([body, tag]);
    this.ghostBall = c;
  }

  private makeBall(): Phaser.GameObjects.Container {
    const c = this.add.container(this.ballPos.x, this.ballPos.y);
    const body = this.add.circle(0, 0, BALL_R, COLORS.ball);
    const shine = this.add.circle(-4, -5, BALL_R * 0.32, 0xffffff, 0.9);
    body.setStrokeStyle(2, 0xd8d8d8);
    c.add([body, shine]);
    return c;
  }

  private fitCamera() {
    const { width, height } = this.scale;
    const zoom = Math.min(width / WORLD_W, height / WORLD_H);
    const cam = this.cameras.main;
    cam.setZoom(zoom);
    cam.centerOn(WORLD_W / 2, WORLD_H / 2);
  }

  private drawCourse() {
    const g = this.add.graphics().setDepth(0);
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const t = this.layout.cells[r * GRID_COLS + c];
        const x = c * CELL;
        const y = r * CELL;
        // grass checker base everywhere (visible under sand/water edges)
        g.fillStyle((c + r) % 2 === 0 ? COLORS.grassA : COLORS.grassB);
        g.fillRect(x, y, CELL, CELL);
        if (t === TILE.SAND) {
          g.fillStyle(COLORS.sand);
          g.fillRoundedRect(x + 2, y + 2, CELL - 4, CELL - 4, 10);
        } else if (t === TILE.WATER) {
          g.fillStyle(COLORS.waterDeep);
          g.fillRect(x, y, CELL, CELL);
          g.fillStyle(COLORS.water);
          g.fillRoundedRect(x + 3, y + 3, CELL - 6, CELL - 6, 8);
        }
      }
    }
    // walls on top, with a lip for depth
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const t = this.layout.cells[r * GRID_COLS + c];
        if (t !== TILE.WALL) continue;
        const x = c * CELL;
        const y = r * CELL;
        g.fillStyle(COLORS.wall);
        g.fillRect(x, y, CELL, CELL);
        g.fillStyle(COLORS.wallTop);
        g.fillRect(x + 3, y + 3, CELL - 6, CELL - 10);
      }
    }
    // cup
    const cup = cellCenter(this.layout.cup);
    g.fillStyle(0x000000, 0.35);
    g.fillEllipse(cup.x, cup.y + 3, CUP_R * 2.3, CUP_R * 1.6);
    g.fillStyle(COLORS.cup);
    g.fillCircle(cup.x, cup.y, CUP_R);
    // flag
    const flag = this.add.graphics().setDepth(3);
    flag.lineStyle(4, 0xf5f5f5).lineBetween(cup.x, cup.y, cup.x, cup.y - 74);
    flag.fillStyle(0xe63946).fillTriangle(cup.x, cup.y - 74, cup.x, cup.y - 48, cup.x + 40, cup.y - 61);
    // tee marker
    const tee = cellCenter(this.layout.tee);
    g.lineStyle(3, 0xffffff, 0.55).strokeCircle(tee.x, tee.y, BALL_R + 8);
  }

  private setupInput() {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.rolling || this.sunk) return;
      this.aiming = true;
      this.dragStart = { x: p.worldX, y: p.worldY };
      this.dragNow = { ...this.dragStart };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.aiming) return;
      this.dragNow = { x: p.worldX, y: p.worldY };
      this.drawAim();
    });
    this.input.on('pointerup', () => {
      if (!this.aiming) return;
      this.aiming = false;
      this.aimG.clear();
      const v = this.shotVector();
      if (Math.hypot(v.x, v.y) < 1.4) return; // too weak, ignore
      this.fire(v);
    });
  }

  // Pull-back slingshot: drag down-right → ball goes up-left
  private shotVector(): Vec2 {
    const dx = this.dragStart.x - this.dragNow.x;
    const dy = this.dragStart.y - this.dragNow.y;
    const len = Math.hypot(dx, dy);
    const power = Math.min(len / 9, MAX_SHOT_SPEED);
    if (len === 0) return { x: 0, y: 0 };
    return { x: (dx / len) * power, y: (dy / len) * power };
  }

  private drawAim() {
    const g = this.aimG;
    g.clear();
    const v = this.shotVector();
    const power = Math.hypot(v.x, v.y);
    if (power < 1.4) return;
    const norm = power / MAX_SHOT_SPEED;
    // dotted line in shot direction
    const dots = 3 + Math.floor(norm * 9);
    const color = Phaser.Display.Color.Interpolate.ColorWithColor(
      new Phaser.Display.Color(255, 255, 255),
      new Phaser.Display.Color(230, 57, 70),
      100,
      Math.floor(norm * 100)
    );
    const tint = Phaser.Display.Color.GetColor(color.r, color.g, color.b);
    for (let i = 1; i <= dots; i++) {
      const d = i * 26;
      g.fillStyle(tint, 1 - i / (dots + 4));
      g.fillCircle(this.ballPos.x + (v.x / power) * d, this.ballPos.y + (v.y / power) * d, 7 - i * 0.28);
    }
    // power ring around ball
    g.lineStyle(5, tint, 0.9);
    g.beginPath();
    g.arc(this.ballPos.x, this.ballPos.y, BALL_R + 11, -Math.PI / 2, -Math.PI / 2 + norm * Math.PI * 2);
    g.strokePath();
  }

  private fire(vel: Vec2) {
    sfx.putt(Math.hypot(vel.x, vel.y));
    const shot: Shot = { start: { ...this.ballPos }, vel };
    this.shots.push(shot);
    this.strokes++;
    this.updateHud();
    this.sim = simulateShot(this.layout, shot);
    this.simIndex = 0;
    this.rolling = true;
    this.ghostRunning = true; // ghost race starts on first flick
  }

  override update() {
    // ghost replay advances at match pace whenever running
    if (this.ghostRunning && this.ghostBall && this.ghostIndex < this.ghostPath.length - 1) {
      this.ghostIndex = Math.min(this.ghostIndex + 2, this.ghostPath.length - 1);
      const gp = this.ghostPath[this.ghostIndex]!;
      this.ghostBall.setPosition(gp.x, gp.y);
      if (this.ghostIndex >= this.ghostPath.length - 1) {
        this.tweens.add({ targets: this.ghostBall, alpha: 0, scale: 0.3, duration: 300 });
      }
    }
    if (!this.rolling || !this.sim) return;
    // play back sim path at ~2 ticks per frame for a lively pace
    for (let step = 0; step < 2 && this.rolling; step++) {
      this.simIndex++;
      const path = this.sim.path;
      if (this.simIndex >= path.length) {
        this.finishShot();
        break;
      }
      const p = path[this.simIndex]!;
      this.ballPos = { x: p.x, y: p.y };
      this.ball.setPosition(p.x, p.y);
      this.ballShadow.setPosition(p.x + 3, p.y + 5);
      // fire events whose tick just passed
      for (const ev of this.sim.events) {
        if (ev.tick === this.simIndex) this.onSimEvent(ev.type, ev.pos);
      }
    }
  }

  private onSimEvent(type: string, pos: Vec2) {
    if (type === 'bounce') {
      sfx.bounce();
      this.cameras.main.shake(60, 0.004);
      this.puff(pos, 0xffffff, 4);
    } else if (type === 'water') {
      sfx.splash();
      this.puff(pos, 0x9bd4f5, 12);
      this.tweens.add({ targets: this.ball, scale: 0.2, alpha: 0, duration: 220 });
    } else if (type === 'sunk') {
      if (this.strokes === 1) sfx.ace();
      else sfx.sink();
      this.tweens.add({ targets: this.ball, scale: 0.15, alpha: 0, duration: 260, ease: 'Cubic.in' });
      this.cameras.main.shake(90, 0.005);
    }
  }

  private puff(pos: Vec2, color: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n;
      const dot = this.add.circle(pos.x, pos.y, 5, color, 0.9).setDepth(7);
      this.tweens.add({
        targets: dot,
        x: pos.x + Math.cos(a) * 42,
        y: pos.y + Math.sin(a) * 42,
        alpha: 0,
        scale: 0.3,
        duration: 330,
        onComplete: () => dot.destroy(),
      });
    }
  }

  private finishShot() {
    const sim = this.sim!;
    this.rolling = false;
    this.sim = null;

    if (sim.sunk) {
      this.sunk = true;
      this.celebrate();
      return;
    }
    if (sim.water) {
      // +1 penalty stroke, ball returns to where it was hit
      this.strokes++;
      this.ballPos = { ...sim.end };
      this.ball.setAlpha(0).setScale(1);
      this.ball.setPosition(this.ballPos.x, this.ballPos.y);
      this.ballShadow.setPosition(this.ballPos.x + 3, this.ballPos.y + 5);
      this.tweens.add({ targets: this.ball, alpha: 1, duration: 250 });
      this.updateHud();
      return;
    }
    this.ballPos = { ...sim.end };
  }

  private celebrate() {
    const cup = cellCenter(this.layout.cup);
    this.puff(cup, 0xffd700, 16);
    const label = this.strokes === 1 ? 'ACE! 🏆' : `Sunk in ${this.strokes}`;
    const txt = this.add
      .text(WORLD_W / 2, WORLD_H / 2 - 60, label, {
        fontFamily: 'Arial Black',
        fontSize: 64,
        color: '#ffd700',
        stroke: '#000000',
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setScale(0.2);
    this.tweens.add({ targets: txt, scale: 1, duration: 380, ease: 'Back.out' });

    if (this.holeId) {
      void this.submitRun(txt);
    } else {
      this.time.delayedCall(900, () => {
        this.onFinished?.(this.strokes, this.shots);
      });
    }
  }

  private async submitRun(headline: Phaser.GameObjects.Text) {
    let sub = 'saving…';
    const subText = this.add
      .text(WORLD_W / 2, WORLD_H / 2 + 10, sub, {
        fontFamily: 'Arial Black',
        fontSize: 30,
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(20);
    try {
      const res = await api.submitRun({
        holeId: this.holeId!,
        strokes: this.strokes,
        shots: this.shots,
      });
      sub = res.newRecord ? `🏆 NEW RECORD! +${res.points} pts` : `+${res.points} pts`;
      if (res.newRecord) {
        headline.setText(this.strokes === 1 ? 'ACE! 🏆' : 'NEW RECORD!');
        this.cameras.main.shake(150, 0.006);
      }
    } catch (e) {
      console.error('submit failed', e);
      sub = 'score not saved (offline?)';
    }
    subText.setText(sub);
    const btn = this.add
      .text(WORLD_W / 2, WORLD_H / 2 + 90, '▶ NEXT', {
        fontFamily: 'Arial Black',
        fontSize: 34,
        color: '#ffffff',
        backgroundColor: '#e63946',
        padding: { x: 30, y: 14 } as Phaser.Types.GameObjects.Text.TextPadding,
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.scene.start('World'));
  }

  private updateHud() {
    this.hud.setText(`${this.holeName}  ·  Stroke ${this.strokes}`);
  }
}
