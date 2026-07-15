import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';
import { resetWorld } from '../core/reset';

export const menu = new Hono();

// Moderator-only: wipe all game data so the world reseeds pristine on the
// next load. Used to clean test traffic before judging.
menu.post('/reset-world', async (c) => {
  try {
    const n = await resetWorld();
    return c.json<UiResponse>({ showToast: `World reset (${n} holes cleared). Reload the post.` }, 200);
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
