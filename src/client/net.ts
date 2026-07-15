import type {
  WorldResponse,
  HoleResponse,
  ShotResultRequest,
  ShotResultResponse,
  PublishHoleRequest,
  PublishHoleResponse,
} from '../shared/types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${path} → ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}

export type LeaderboardResponse = {
  rows: { username: string; points: number }[];
  me: string;
};

export const api = {
  world: () => req<WorldResponse>('/api/world'),
  leaderboard: () => req<LeaderboardResponse>('/api/leaderboard'),
  hole: (id: string) => req<HoleResponse>(`/api/hole/${id}`),
  submitRun: (body: ShotResultRequest) =>
    req<ShotResultResponse>('/api/shot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  publishHole: (body: PublishHoleRequest) =>
    req<PublishHoleResponse>('/api/hole', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};
