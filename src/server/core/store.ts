import { redis } from '@devvit/web/server';
import type { Hole, HoleRecord, UserState } from '../../shared/types';

// ── Redis keys ──────────────────────────────────────────────────
// world:chain          → JSON string[] of hole ids, play order
// hole:{id}            → JSON Hole
// record:{id}          → JSON HoleRecord
// user:{username}      → JSON UserState
// seq:hole             → incrementing id counter

const DAILY_TOKENS = 10;

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getChain(): Promise<string[]> {
  const raw = await redis.get('world:chain');
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function appendToChain(holeId: string): Promise<void> {
  const chain = await getChain();
  chain.push(holeId);
  await redis.set('world:chain', JSON.stringify(chain));
}

export async function nextHoleId(): Promise<string> {
  const n = await redis.incrBy('seq:hole', 1);
  return String(n);
}

export async function getHole(id: string): Promise<Hole | null> {
  const raw = await redis.get(`hole:${id}`);
  return raw ? (JSON.parse(raw) as Hole) : null;
}

export async function saveHole(hole: Hole): Promise<void> {
  await redis.set(`hole:${hole.id}`, JSON.stringify(hole));
}

export async function getRecord(holeId: string): Promise<HoleRecord | null> {
  const raw = await redis.get(`record:${holeId}`);
  return raw ? (JSON.parse(raw) as HoleRecord) : null;
}

export async function saveRecord(holeId: string, rec: HoleRecord): Promise<void> {
  await redis.set(`record:${holeId}`, JSON.stringify(rec));
}

// Loads user state, applying the daily token refill + streak logic lazily
// (no scheduler dependency for correctness; scheduler is a bonus).
export async function getUser(username: string): Promise<UserState> {
  const raw = await redis.get(`user:${username}`);
  const today = todayUTC();
  if (!raw) {
    const fresh: UserState = {
      username,
      tokens: DAILY_TOKENS,
      streak: 0,
      points: 0,
      lastPlayedDay: '',
      completed: [],
    };
    await redis.set(`user:${username}`, JSON.stringify(fresh));
    return fresh;
  }
  const u = JSON.parse(raw) as UserState;
  if (u.lastPlayedDay !== today) {
    // new day: refill tokens; streak advances if they played yesterday
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    u.streak = u.lastPlayedDay === yesterday ? u.streak : 0;
    u.tokens = DAILY_TOKENS;
    await redis.set(`user:${username}`, JSON.stringify(u));
  }
  return u;
}

export async function saveUser(u: UserState): Promise<void> {
  await redis.set(`user:${u.username}`, JSON.stringify(u));
}

// Marks activity today: consumes tokens, bumps streak on first play of day.
export function touchToday(u: UserState): void {
  const today = todayUTC();
  if (u.lastPlayedDay !== today) {
    u.streak += 1;
    u.lastPlayedDay = today;
  }
}
