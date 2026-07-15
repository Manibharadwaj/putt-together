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
import { FONT, HEX, PALETTE, drawButton, drawBack } from '../ui';
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
  grassA: PALETTE.grassA,
  grassB: PALETTE.grassB,
  wall: PALETTE.wall,
  wallTop: PALETTE.wallTop,
  sand: PALETTE.sand,
  water: PALETTE.water,
  waterDeep: PALETTE.waterDeep,
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

  private flagPennant!: Phaser.GameObjects.Graphics;
  private cupPulse!: Phaser.GameObjects.Graphics;
  private waterG!: Phaser.GameObjects.Graphics;
  private waterCells: Vec2[] = [];
  private aimPhase = 0;
  private trailTick = 0;

  create() {
    const cam = this.cameras.main;
    cam.setBackgroundColor(0x2e6b28);
    cam.fadeIn(240, 10, 30, 12);
    this.drawCourse();
    this.startAmbient();

    this.ballPos = cellCenter(this.layout.tee);
    this.ballShadow = this.add
      .ellipse(this.ballPos.x + 3, this.ballPos.y + 5, BALL_R * 2, BALL_R * 1.5, 0x000000, 0.25)
      .setDepth(4);
    this.ball = this.makeBall().setDepth(5);
    this.aimG = this.add.graphics().setDepth(6);

    const hudChip = this.add.graphics().setDepth(9);
    hudChip.fillStyle(0x000000, 0.32);
    hudChip.fillRoundedRect(WORLD_W / 2 - 210, 16, 420, 46, 23);
    this.hud = this.add
      .text(WORLD_W / 2, 39, '', {
        fontFamily: FONT,
        fontSize: 26,
        color: HEX.cream,
      })
      .setOrigin(0.5)
      .setDepth(10);
    this.updateHud();

    this.fitCamera();
    this.scale.on('resize', () => this.fitCamera());
    this.setupInput();
    this.setupGhost();

    if (this.holeId) {
      drawBack(this, () => this.scene.start('World'));
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
        fontFamily: FONT,
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
    // flag pole (static) + waving pennant (animated in startAmbient)
    const pole = this.add.graphics().setDepth(3);
    pole.lineStyle(4, 0xf5f5f5).lineBetween(cup.x, cup.y, cup.x, cup.y - 74);
    this.flagPennant = this.add.graphics().setDepth(3);
    this.flagPennant.setPosition(cup.x, cup.y - 74);
    this.flagPennant.fillStyle(0xe6503f);
    this.flagPennant.fillTriangle(0, 0, 0, 26, 40, 13);
    // tee marker
    const tee = cellCenter(this.layout.tee);
    g.lineStyle(3, 0xffffff, 0.55).strokeCircle(tee.x, tee.y, BALL_R + 8);
  }

  // ambient motion: the course is alive even when nobody touches it
  private startAmbient() {
    // pennant flutter
    this.tweens.add({
      targets: this.flagPennant,
      scaleX: 0.72,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    // inviting pulse ring around the cup
    const cup = cellCenter(this.layout.cup);
    this.cupPulse = this.add.graphics().setDepth(2);
    this.cupPulse.lineStyle(4, 0xffffff, 0.5);
    this.cupPulse.strokeCircle(0, 0, CUP_R + 4);
    this.cupPulse.setPosition(cup.x, cup.y);
    this.tweens.add({
      targets: this.cupPulse,
      scale: 1.8,
      alpha: 0,
      duration: 1400,
      repeat: -1,
      ease: 'Quad.out',
    });
    // shimmering water
    this.waterCells = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (this.layout.cells[r * GRID_COLS + c] === TILE.WATER) {
          this.waterCells.push({ x: c, y: r });
        }
      }
    }
    this.waterG = this.add.graphics().setDepth(1);
  }

  private drawWater(time: number) {
    if (this.waterCells.length === 0) return;
    const g = this.waterG;
    g.clear();
    g.lineStyle(2.5, 0xd9f0ff, 0.55);
    for (const cell of this.waterCells) {
      const x0 = cell.x * CELL;
      const y0 = cell.y * CELL;
      const ph = time / 500 + cell.x * 1.3 + cell.y * 0.9;
      for (let i = 0; i < 2; i++) {
        const wy = y0 + 20 + i * 24 + Math.sin(ph + i * 2) * 4;
        g.beginPath();
        g.moveTo(x0 + 10, wy);
        g.lineTo(x0 + 22, wy - 4);
        g.lineTo(x0 + 34, wy);
        g.lineTo(x0 + 46, wy - 4);
        g.strokePath();
      }
    }
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
      const d = i * 26 + this.aimPhase;
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

  override update(time: number) {
    this.drawWater(time);
    // marching aim dots while aiming
    if (this.aiming) {
      this.aimPhase = (this.aimPhase + 0.8) % 26;
      this.drawAim();
    }
    // rolling ball leaves a fading trail
    if (this.rolling && ++this.trailTick % 3 === 0) {
      const dot = this.add
        .circle(this.ballPos.x, this.ballPos.y, BALL_R * 0.55, 0xffffff, 0.28)
        .setDepth(3);
      this.tweens.add({
        targets: dot,
        alpha: 0,
        scale: 0.2,
        duration: 300,
        onComplete: () => dot.destroy(),
      });
    }
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
      // squash & stretch on impact
      this.ball.setScale(1.3, 0.75);
      this.tweens.add({ targets: this.ball, scaleX: 1, scaleY: 1, duration: 180, ease: 'Back.out' });
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
    if (this.holeId) {
      void this.showResults();
    } else {
      // editor test run: quick banner, then hand back to the builder
      const label = this.strokes === 1 ? 'ACE!' : `Sunk in ${this.strokes}`;
      const txt = this.add
        .text(WORLD_W / 2, WORLD_H / 2 - 60, label, {
          fontFamily: FONT,
          fontSize: 68,
          color: HEX.gold,
          stroke: '#000000',
          strokeThickness: 10,
        })
        .setOrigin(0.5)
        .setDepth(20)
        .setScale(0.2);
      this.tweens.add({ targets: txt, scale: 1, duration: 380, ease: 'Back.out' });
      this.time.delayedCall(900, () => {
        this.onFinished?.(this.strokes, this.shots);
      });
    }
  }

  // ── the win screen: stars, confetti, counting points ──────────
  private async showResults() {
    // submit while the cup-drop effect plays
    let points = 0;
    let newRecord = false;
    let saveFailed = false;
    try {
      const res = await api.submitRun({
        holeId: this.holeId!,
        strokes: this.strokes,
        shots: this.shots,
      });
      points = res.points;
      newRecord = res.newRecord;
    } catch (e) {
      console.error('submit failed', e);
      saveFailed = true;
    }

    const cx = WORLD_W / 2;
    const cy = WORLD_H / 2;
    const overlay = this.add
      .rectangle(cx, cy, WORLD_W * 2, WORLD_H * 2, 0x000000, 0)
      .setDepth(19);
    this.tweens.add({ targets: overlay, fillAlpha: 0.55, duration: 300 });

    const panelG = this.add.graphics().setDepth(20).setAlpha(0);
    panelG.fillStyle(0x000000, 0.3);
    panelG.fillRoundedRect(cx - 310 + 5, cy - 260 + 8, 620, 520, 28);
    panelG.fillStyle(PALETTE.fairwayDark, 1);
    panelG.fillRoundedRect(cx - 310, cy - 260, 620, 520, 28);
    panelG.lineStyle(5, PALETTE.gold, 1);
    panelG.strokeRoundedRect(cx - 310, cy - 260, 620, 520, 28);
    this.tweens.add({ targets: panelG, alpha: 1, duration: 320 });

    // headline
    const headline = newRecord
      ? this.strokes === 1
        ? 'ACE! NEW RECORD!'
        : 'NEW RECORD!'
      : this.strokes === 1
        ? 'ACE!'
        : this.strokes <= 2
          ? 'GREAT PUTT!'
          : 'SUNK IT!';
    const head = this.add
      .text(cx, cy - 190, headline, {
        fontFamily: FONT,
        fontSize: newRecord ? 48 : 58,
        color: HEX.gold,
        stroke: '#000000',
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setDepth(21)
      .setScale(0.2);
    this.tweens.add({ targets: head, scale: 1, duration: 400, ease: 'Back.out', delay: 150 });
    if (newRecord) this.cameras.main.shake(180, 0.007);

    // rotating sunburst behind the stars
    const rays = this.add.graphics().setDepth(20).setAlpha(0);
    rays.setPosition(cx, cy - 80);
    rays.fillStyle(PALETTE.gold, 0.12);
    for (let i = 0; i < 12; i++) {
      const a0 = (i * Math.PI) / 6;
      const a1 = a0 + Math.PI / 14;
      rays.fillTriangle(
        0, 0,
        Math.cos(a0) * 260, Math.sin(a0) * 260,
        Math.cos(a1) * 260, Math.sin(a1) * 260
      );
    }
    this.tweens.add({ targets: rays, alpha: 1, duration: 500, delay: 400 });
    this.tweens.add({ targets: rays, angle: 360, duration: 14000, repeat: -1 });

    // stars: 3 = ace or record, 2 = par or better, 1 = finished
    const stars = this.strokes === 1 || newRecord ? 3 : this.strokes <= 2 ? 2 : 1;
    for (let i = 0; i < 3; i++) {
      const sx = cx + (i - 1) * 120;
      const filled = i < stars;
      const star = this.add
        .text(sx, cy - 80, '★', {
          fontSize: 96,
          color: filled ? '#ffd700' : '#3a3a3a',
          stroke: '#000000',
          strokeThickness: 8,
        })
        .setOrigin(0.5)
        .setDepth(21)
        .setScale(0)
        .setAngle(-30);
      this.tweens.add({
        targets: star,
        scale: filled ? 1 : 0.75,
        angle: 0,
        duration: 330,
        ease: 'Back.out',
        delay: 420 + i * 260,
        onStart: () => {
          if (filled) sfx.sink();
        },
      });
      if (filled) {
        this.time.delayedCall(430 + i * 260, () => this.puff({ x: sx, y: cy - 80 }, 0xffd700, 8));
      }
    }

    // strokes line
    this.add
      .text(cx, cy + 10, `sunk in ${this.strokes} stroke${this.strokes === 1 ? '' : 's'}`, {
        fontFamily: FONT,
        fontSize: 26,
        color: HEX.paleGreen,
      })
      .setOrigin(0.5)
      .setDepth(21);

    // points counter rolls up
    const ptsText = this.add
      .text(cx, cy + 68, saveFailed ? 'score not saved — offline?' : '+0 pts', {
        fontFamily: FONT,
        fontSize: 46,
        color: saveFailed ? '#ff9999' : '#9be564',
        stroke: '#000000',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(21);
    if (!saveFailed) {
      const counter = { v: 0 };
      this.tweens.add({
        targets: counter,
        v: points,
        duration: 800,
        delay: 1200,
        ease: 'Cubic.out',
        onUpdate: () => ptsText.setText(`+${Math.round(counter.v)} pts`),
      });
    }

    // confetti rain
    this.time.delayedCall(350, () => this.confetti(stars * 24));

    // buttons
    drawButton(
      this,
      cx - 135,
      cy + 176,
      { w: 220, h: 74, fill: PALETTE.blue, fillDark: 0x24509e, label: 'RETRY', size: 28 },
      () => {
        sfx.click();
        this.scene.restart({
          layout: this.layout,
          holeName: this.holeName,
          holeId: this.holeId,
          ghost: this.ghost,
        });
      }
    ).setDepth(21);
    drawButton(
      this,
      cx + 135,
      cy + 176,
      { w: 220, h: 74, fill: PALETTE.accent, fillDark: PALETTE.accentDark, label: 'NEXT', size: 28 },
      () => {
        sfx.click();
        this.scene.start('World');
      }
    ).setDepth(21);
  }

  private confetti(n: number) {
    const colors = [0xffd700, 0xe63946, 0x2d6cdf, 0x66bb6a, 0xffffff, 0xff8c00];
    for (let i = 0; i < n; i++) {
      const x = Math.random() * WORLD_W;
      const piece = this.add
        .rectangle(x, -20 - Math.random() * 200, 10 + Math.random() * 8, 14 + Math.random() * 8,
          colors[i % colors.length])
        .setDepth(22)
        .setAngle(Math.random() * 360);
      this.tweens.add({
        targets: piece,
        y: WORLD_H + 40,
        x: x + (Math.random() - 0.5) * 220,
        angle: piece.angle + 360 + Math.random() * 540,
        duration: 1600 + Math.random() * 1400,
        ease: 'Cubic.in',
        onComplete: () => piece.destroy(),
      });
    }
  }

  private updateHud() {
    this.hud.setText(`${this.holeName}  ·  Stroke ${this.strokes}`);
  }
}
