import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type {
  WorldResponse,
  WorldCourse,
  WorldHole,
  HoleResponse,
  ShotResultRequest,
  ShotResultResponse,
  PublishHoleRequest,
  PublishHoleResponse,
  Hole,
  Theme,
} from '../../shared/types';
import { validateLayout, validateRun } from '../../shared/physics';
import {
  getChain,
  appendToChain,
  nextHoleId,
  getHole,
  saveHole,
  getRecord,
  saveRecord,
  getUser,
  saveUser,
  touchToday,
  topPlayers,
} from '../core/store';
import { redis } from '@devvit/web/server';
import { SEED_HOLES } from '../core/seeds';

export const api = new Hono();

// First visitor to a fresh install triggers the starter course.
// Idempotent by name: installs that predate newer seed batches pick up
// the missing holes without disturbing player-built ones.
async function seedIfEmpty(): Promise<void> {
  // atomic claim — concurrent visitors can't double-seed
  const claim = await redis.incrBy('world:seedbatch3', 1);
  if (claim !== 1) return;
  const chain = await getChain();
  const existing = new Map<string, Hole>();
  for (const id of chain) {
    const h = await getHole(id);
    if (h && h.author === 'putt_together') existing.set(h.name, h);
  }
  for (const s of SEED_HOLES) {
    const prev = existing.get(s.name);
    if (prev) {
      // older batch without themes: stamp the theme in place
      if (!prev.theme) {
        prev.theme = s.theme;
        await saveHole(prev);
      }
      continue;
    }
    const id = await nextHoleId();
    await saveHole({
      id,
      name: s.name,
      author: 'putt_together',
      layout: s.layout,
      par: 2,
      theme: s.theme,
      createdAt: Date.now(),
      plays: 0,
      aces: 0,
    });
    await saveRecord(id, {
      holder: 'putt_together',
      strokes: 1,
      shots: [s.ace],
      setAt: Date.now(),
    });
    await appendToChain(id);
  }
}

const COURSE_ORDER: { theme: Theme; title: string }[] = [
  { theme: 'meadow', title: 'Meadow Springs' },
  { theme: 'dunes', title: 'Sunbaked Dunes' },
  { theme: 'frost', title: 'Frostbite Falls' },
  { theme: 'forest', title: 'Whispering Woods' },
  { theme: 'community', title: 'Community Course' },
];
const UNLOCK_AT = 5; // completions in the previous course

async function currentUsername(): Promise<string> {
  const name = await reddit.getCurrentUsername();
  return name ?? 'anonymous';
}

// ── World: themed courses + my state ────────────────────────────
api.get('/world', async (c) => {
  await seedIfEmpty();
  const username = await currentUsername();
  const me = await getUser(username);
  const chain = await getChain();
  const holes = await Promise.all(
    chain.map(async (id): Promise<WorldHole | null> => {
      const [hole, record] = await Promise.all([getHole(id), getRecord(id)]);
      if (!hole) return null;
      return {
        id: hole.id,
        name: hole.name,
        author: hole.author,
        par: hole.par,
        plays: hole.plays,
        theme: hole.theme ?? 'community',
        layout: hole.layout,
        record: record ? { holder: record.holder, strokes: record.strokes } : null,
        completedByMe: me.completed.includes(hole.id),
      };
    })
  );
  const all = holes.filter((h): h is WorldHole => h !== null);

  // progression: each themed course unlocks after UNLOCK_AT clears in the
  // previous one; the community course is always open.
  const courses: WorldCourse[] = [];
  let prevDone = Infinity; // first course always unlocked
  let prevTitle = '';
  for (const meta of COURSE_ORDER) {
    const courseHoles = all.filter((h) => h.theme === meta.theme);
    const done = courseHoles.filter((h) => h.completedByMe).length;
    const locked = meta.theme !== 'community' && prevDone < UNLOCK_AT;
    courses.push({
      theme: meta.theme,
      title: meta.title,
      holes: courseHoles,
      locked,
      unlockHint: locked ? `finish ${UNLOCK_AT} holes in ${prevTitle} to unlock` : '',
    });
    if (meta.theme !== 'community') {
      prevDone = done;
      prevTitle = meta.title;
    }
  }
  return c.json<WorldResponse>({ courses, me });
});

// ── One hole: layout + record ghost ─────────────────────────────
api.get('/hole/:id', async (c) => {
  const id = c.req.param('id');
  const hole = await getHole(id);
  if (!hole) return c.json({ error: 'not found' }, 404);
  const record = await getRecord(id);
  return c.json<HoleResponse>({ hole, record });
});

// ── Finish a run: validate, score, maybe set record ─────────────
api.post('/shot', async (c) => {
  const body = (await c.req.json()) as ShotResultRequest;
  const username = await currentUsername();
  const hole = await getHole(body.holeId);
  if (!hole) return c.json({ error: 'hole not found' }, 404);

  // server-side re-simulation: cheating is physically impossible
  const check = validateRun(hole.layout, body.shots);
  if (!check.valid) return c.json({ error: 'invalid run' }, 400);
  const strokes = check.strokes;

  const me = await getUser(username);
  touchToday(me);

  // scoring: base for completion, bonus for under/at par, ace jackpot.
  // Out of daily energy → runs still count, but score nothing.
  let points = 0;
  if (me.tokens > 0) {
    me.tokens -= 1;
    points = 10;
    if (strokes === 1) points += 40;
    else if (strokes <= hole.par) points += 15;
  }
  const firstClear = !me.completed.includes(hole.id);
  if (firstClear) {
    me.completed.push(hole.id);
    points += 10;
  }
  me.points += points;
  await saveUser(me);

  hole.plays += 1;
  if (strokes === 1) hole.aces += 1;

  // record check
  const prev = await getRecord(hole.id);
  let newRecord = false;
  if (!prev || strokes < prev.strokes) {
    newRecord = true;
    await saveRecord(hole.id, {
      holder: username,
      strokes,
      shots: body.shots,
      setAt: Date.now(),
    });
    // creator earns royalties when their hole gets a new record chase
    if (hole.author !== username) {
      const creator = await getUser(hole.author);
      creator.points += 5;
      await saveUser(creator);
    }
    // announce in the post's comments (best-effort)
    if (prev && context.postId) {
      try {
        await reddit.submitComment({
          id: context.postId,
          text: `🏆 **New record on "${hole.name}"** — u/${username} sank it in ${strokes} stroke${strokes === 1 ? '' : 's'}, beating u/${prev.holder}'s ${prev.strokes}. Think you can do better?`,
        });
      } catch (e) {
        console.error('record comment failed:', e);
      }
    }
  }
  await saveHole(hole);

  return c.json<ShotResultResponse>({ newRecord, points, me });
});

// ── Publish a hole (ace-gated) ──────────────────────────────────
api.post('/hole', async (c) => {
  const body = (await c.req.json()) as PublishHoleRequest;
  const username = await currentUsername();

  const layoutErr = validateLayout(body.layout);
  if (layoutErr) {
    return c.json<PublishHoleResponse>({ ok: false, error: layoutErr });
  }
  // THE GATE: the creator's submitted proof must be a real ace on this
  // exact layout — re-simulated on the server. Every published hole is
  // beatable in one stroke by construction.
  const proof = validateRun(body.layout, body.aceShots);
  if (!proof.valid || proof.strokes !== 1) {
    return c.json<PublishHoleResponse>({ ok: false, error: 'ace proof failed' });
  }

  const name = (body.name || 'Untitled').slice(0, 32).trim() || 'Untitled';
  const id = await nextHoleId();
  const hole: Hole = {
    id,
    name,
    author: username,
    layout: body.layout,
    par: 2, // aceable by construction; par 2 keeps scoring generous
    theme: 'community',
    createdAt: Date.now(),
    plays: 0,
    aces: 0,
  };
  await saveHole(hole);
  // creator's own ace stands as the record to beat
  await saveRecord(id, { holder: username, strokes: 1, shots: body.aceShots, setAt: Date.now() });
  await appendToChain(id);

  const me = await getUser(username);
  touchToday(me);
  me.points += 25; // creating pays more than playing
  if (!me.completed.includes(id)) me.completed.push(id);
  await saveUser(me);

  // announce the new hole (best-effort)
  if (context.postId) {
    try {
      await reddit.submitComment({
        id: context.postId,
        text: `⛳ **Hole ${id}: "${name}"** just opened — built by u/${username}, who aced it to prove it's possible. Record to beat: **1 stroke**.`,
      });
    } catch (e) {
      console.error('publish comment failed:', e);
    }
  }

  return c.json<PublishHoleResponse>({ ok: true, holeId: id });
});

// ── Me ──────────────────────────────────────────────────────────
api.get('/me', async (c) => {
  const username = await currentUsername();
  const me = await getUser(username);
  return c.json(me);
});

// ── Leaderboard: top putters by points ──────────────────────────
api.get('/leaderboard', async (c) => {
  const username = await currentUsername();
  const rows = await topPlayers(10);
  return c.json({ rows, me: username });
});
