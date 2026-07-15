import { reddit, redis } from '@devvit/web/server';

export const createPost = async () => {
  const post = await reddit.submitCustomPost({
    title: '⛳ Putt Together — one mini-golf course, built hole by hole by YOU',
    textFallback: {
      text: 'Putt Together is an endless community mini-golf course. Play holes built by other redditors, race the record holder’s ghost, then design your own hole — you can only publish it after acing it yourself. Open this post in the Reddit app or new reddit to play.',
    },
  });
  // remembered so scheduled jobs can comment on the game post
  await redis.set('main:post', post.id);
  return post;
};
