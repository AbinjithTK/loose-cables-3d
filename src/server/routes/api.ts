import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import type {
  DailyEntry,
  DailyScoreRequest,
  DailyScoreResponse,
  ErrorResponse,
  InitResponse,
  LevelCompleteRequest,
  LevelCompleteResponse,
  LevelProgress,
  PlayerProfile,
  ToolSpendRequest,
  ToolSpendResponse,
} from '../../shared/api';
import {
  generateCampaignLevel,
  getLevel,
  starsForClear,
  timeBonusTies,
  zipTiesForClear,
} from '../../shared/levels/campaign';
import { checkAchievements, rewardsFor } from '../../shared/achievements';
import type { CompletionContext } from '../../shared/achievements';

export const api = new Hono();

// ---------------------------------------------------------------------------
// Profile storage (Redis hash per user)
// ---------------------------------------------------------------------------

function profileKey(username: string): string {
  return `profile:${username}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadProfile(username: string): Promise<PlayerProfile> {
  const raw = await redis.get(profileKey(username));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as PlayerProfile;
      // Backfill fields added in later versions so older saved profiles stay valid.
      parsed.tools = parsed.tools ?? { freeze: 0, cutter: 0 };
      parsed.achievements = parsed.achievements ?? [];
      return parsed;
    } catch {
      // fall through to fresh profile
    }
  }
  return {
    username,
    levels: {},
    zipTies: 0,
    totalStars: 0,
    lastDaily: null,
    streak: 0,
    tools: { freeze: 0, cutter: 0 },
    achievements: [],
  };
}

async function saveProfile(profile: PlayerProfile): Promise<void> {
  await redis.set(profileKey(profile.username), JSON.stringify(profile));
}

function recomputeStars(profile: PlayerProfile): void {
  profile.totalStars = Object.values(profile.levels).reduce((n, l) => n + l.stars, 0);
}

async function currentUsername(): Promise<string> {
  const username = await reddit.getCurrentUsername();
  return username ?? 'anonymous';
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

api.get('/init', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId missing' }, 400);
  }
  try {
    const username = await currentUsername();
    const profile = await loadProfile(username);
    const dailyDate = todayIso();
    return c.json<InitResponse>({
      type: 'init',
      postId,
      profile,
      dailyDate,
      dailyDone: profile.lastDaily === dailyDate,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'init failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/level-complete', async (c) => {
  try {
    const body = (await c.req.json()) as LevelCompleteRequest;
    const level = getLevel(body.levelId);
    if (!level || typeof body.moves !== 'number' || body.moves < 1 || body.moves > 500) {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid payload' }, 400);
    }

    const username = await currentUsername();
    const profile = await loadProfile(username);

    // Server computes stars from the authoritative campaign par.
    const puzzlePar = levelPar(body.levelId);
    const stars = starsForClear(body.moves, puzzlePar);
    const existing: LevelProgress | undefined = profile.levels[body.levelId];
    const firstClear = !existing;

    const improved: LevelProgress = {
      stars: Math.max(existing?.stars ?? 0, stars),
      bestMoves: Math.min(existing?.bestMoves ?? Infinity, body.moves),
    };
    profile.levels[body.levelId] = improved;

    // Time bonus: reward finishing with plenty of clock left.
    const timeSec = typeof body.timeSec === 'number' ? body.timeSec : level.timeLimit;
    const timeLeftSec = Math.max(0, level.timeLimit - timeSec);
    const timeBonus = timeBonusTies(timeLeftSec, level.timeLimit);

    const zipTiesEarned = zipTiesForClear(stars, firstClear) + timeBonus;
    profile.zipTies += zipTiesEarned;
    recomputeStars(profile);

    // Achievements: evaluate against the freshly-updated profile + this clear.
    const ctx: CompletionContext = {
      levelId: body.levelId,
      timeLeftPct: level.timeLimit > 0 ? timeLeftSec / level.timeLimit : 0,
      maxChain: typeof body.maxChain === 'number' ? body.maxChain : 0,
      noTools: body.noTools ?? true,
      isBoss: level.isBoss,
    };
    const unlocked = checkAchievements(profile, ctx);
    if (unlocked.length > 0) {
      profile.achievements = [...profile.achievements, ...unlocked];
      const reward = rewardsFor(unlocked);
      profile.tools.freeze += reward.freeze;
      profile.tools.cutter += reward.cutter;
    }
    await saveProfile(profile);

    return c.json<LevelCompleteResponse>({
      type: 'level-complete',
      stars,
      zipTiesEarned,
      timeBonus,
      unlocked,
      profile,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'save failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

/**
 * Par for a level: regenerate the deterministic campaign level and read its
 * scramble-count par. Cheap (small grids) and always matches the client.
 */
function levelPar(levelId: string): number {
  const level = getLevel(levelId);
  if (!level) return 5;
  return generateCampaignLevel(level).optimalMoves;
}

// ---------------------------------------------------------------------------
// Daily Tangle
// ---------------------------------------------------------------------------

function dailyKey(dateIso: string): string {
  return `daily:${dateIso}`;
}

api.post('/daily-score', async (c) => {
  try {
    const body = (await c.req.json()) as DailyScoreRequest;
    if (
      typeof body.moves !== 'number' || body.moves < 1 || body.moves > 500 ||
      typeof body.timeMs !== 'number' || body.timeMs < 500 || body.timeMs > 3_600_000
    ) {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid payload' }, 400);
    }

    const username = await currentUsername();
    const profile = await loadProfile(username);
    const dateIso = todayIso();
    const key = dailyKey(dateIso);

    // Lower composite score = better: moves dominate, time breaks ties.
    const score = body.moves * 10_000_000 + Math.min(body.timeMs, 9_999_999);
    const already = profile.lastDaily === dateIso;

    let unlocked: string[] = [];
    if (!already) {
      await redis.zAdd(key, { member: username, score });
      await redis.hSet(key + ':meta', {
        [username]: JSON.stringify({ moves: body.moves, timeMs: body.timeMs }),
      });

      // Streak: consecutive days.
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      profile.streak = profile.lastDaily === yesterday ? profile.streak + 1 : 1;
      profile.lastDaily = dateIso;
      profile.zipTies += 3;

      // Streak-based achievements (no per-clear context for the daily).
      unlocked = checkAchievements(profile, null);
      if (unlocked.length > 0) {
        profile.achievements = [...profile.achievements, ...unlocked];
        const reward = rewardsFor(unlocked);
        profile.tools.freeze += reward.freeze;
        profile.tools.cutter += reward.cutter;
      }
      await saveProfile(profile);
    }

    const [rank, total, topRaw] = await Promise.all([
      redis.zRank(key, username),
      redis.zCard(key),
      redis.zRange(key, 0, 9),
    ]);

    const metaRaw = await redis.hGetAll(key + ':meta');
    const top: DailyEntry[] = (topRaw ?? []).map((entry) => {
      const member = typeof entry === 'string' ? entry : entry.member;
      let moves = 0;
      let timeMs = 0;
      const meta = metaRaw?.[member];
      if (meta) {
        try {
          const parsed = JSON.parse(meta) as { moves: number; timeMs: number };
          moves = parsed.moves;
          timeMs = parsed.timeMs;
        } catch { /* ignore */ }
      }
      return { username: member, moves, timeMs };
    });

    return c.json<DailyScoreResponse>({
      type: 'daily-score',
      rank: (rank ?? 0) + 1,
      total: total ?? 1,
      top,
      zipTiesEarned: already ? 0 : 3,
      streak: profile.streak,
      unlocked,
      profile,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'daily failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

// ---------------------------------------------------------------------------
// Tools — spend a Time Freeze / Wire Cutter charge (earned via achievements)
// ---------------------------------------------------------------------------

api.post('/tool-spend', async (c) => {
  try {
    const body = (await c.req.json()) as ToolSpendRequest;
    if (body.tool !== 'freeze' && body.tool !== 'cutter') {
      return c.json<ErrorResponse>({ status: 'error', message: 'invalid tool' }, 400);
    }
    const username = await currentUsername();
    const profile = await loadProfile(username);
    if (profile.tools[body.tool] <= 0) {
      return c.json<ErrorResponse>({ status: 'error', message: 'no charges' }, 400);
    }
    profile.tools[body.tool] -= 1;
    await saveProfile(profile);
    return c.json<ToolSpendResponse>({ type: 'tool-spend', profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'tool-spend failed';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});
