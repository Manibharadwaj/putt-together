import { redis } from '@devvit/web/server';
import { getChain, topPlayers } from './store';

// Wipes the world (holes, records, scores) so it reseeds pristine on the
// next load. Reached only via the moderator "Reset world (admin)" menu.
export async function resetWorld(): Promise<number> {
  const chain = await getChain();
  const keys: string[] = [
    'world:chain',
    'seq:hole',
    'world:seeded',
    'world:seedbatch2',
    'world:seedbatch3',
    'lb:points',
  ];
  for (const id of chain) keys.push(`hole:${id}`, `record:${id}`);
  const players = await topPlayers(100);
  for (const p of players) keys.push(`user:${p.username}`);
  await redis.del(...keys);
  console.log(`world reset: cleared ${chain.length} holes, ${players.length} players`);
  return chain.length;
}
