import { reddit, redis } from '@devvit/web/server';

export const createPost = async () => {
  const post = await reddit.submitCustomPost({
    title: '⛳ Putt Together — one mini-golf course, built hole by hole by YOU',
  });
  // remembered so scheduled jobs can comment on the game post
  await redis.set('main:post', post.id);
  return post;
};
