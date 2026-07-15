import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, redis } from '@devvit/web/server';
import { createPost } from '../core/post';
import { getChain, topPlayers } from '../core/store';

export const menu = new Hono();

// Moderator-only: wipe all game data so the world reseeds pristine on the
// next load. Used to clean test traffic before judging.
menu.post('/reset-world', async (c) => {
  try {
    const chain = await getChain();
    const keys: string[] = ['world:chain', 'seq:hole', 'world:seeded', 'world:seedbatch2', 'world:seedbatch3', 'lb:points'];
    for (const id of chain) keys.push(`hole:${id}`, `record:${id}`);
    const players = await topPlayers(100);
    for (const p of players) keys.push(`user:${p.username}`);
    await redis.del(...keys);
    return c.json<UiResponse>({ showToast: `World reset (${chain.length} holes cleared). Reload the post.` }, 200);
  } catch (error) {
    console.error(`reset failed: ${error}`);
    return c.json<UiResponse>({ showToast: 'Reset failed — check logs' }, 400);
  }
});

menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();

    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>(
      {
        showToast: 'Failed to create post',
      },
      400
    );
  }
});
