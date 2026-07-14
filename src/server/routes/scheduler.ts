import { Hono } from 'hono';
import { redis, reddit } from '@devvit/web/server';
import { getChain, getHole, getRecord } from '../core/store';

export const scheduler = new Hono();

// Daily tee-off: energy refills lazily per-user (see store.getUser), so
// this job's role is the community drumbeat — a fresh comment on the game
// post each morning with the day's most contested hole.
scheduler.post('/daily', async (c) => {
  try {
    const postId = await redis.get('main:post');
    if (!postId) return c.json({ status: 'skipped', message: 'no main post' });

    const chain = await getChain();
    let line = 'The course awaits its first champion.';
    if (chain.length > 0) {
      // spotlight the most-played hole
      let top: { name: string; plays: number; rec: string } | null = null;
      for (const id of chain) {
        const hole = await getHole(id);
        if (!hole) continue;
        if (!top || hole.plays > top.plays) {
          const rec = await getRecord(id);
          top = {
            name: hole.name,
            plays: hole.plays,
            rec: rec ? `u/${rec.holder} holds it at ${rec.strokes}` : 'no record yet',
          };
        }
      }
      if (top) {
        line = `Today's battleground: **"${top.name}"** (${top.plays} plays — ${top.rec}).`;
      }
    }

    await reddit.submitComment({
      id: postId as `t3_${string}`,
      text: `⛳ **Fresh day, fresh energy — 10 new scored runs for everyone.** ${line} Build a hole of your own if you dare (ace required).`,
    });
    return c.json({ status: 'success' });
  } catch (e) {
    console.error('daily job failed:', e);
    return c.json({ status: 'error' }, 500);
  }
});
