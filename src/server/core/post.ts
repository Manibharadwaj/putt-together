import { reddit } from '@devvit/web/server';

export const createPost = async () => {
  return await reddit.submitCustomPost({
    title: '⛳ Putt Together — one mini-golf course, built hole by hole by YOU',
  });
};
