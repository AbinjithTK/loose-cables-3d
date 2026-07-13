import type { PlayerProfile } from './api';
import { CAMPAIGN, LEVELS_PER_WORLD, WORLDS } from './levels/campaign';

/**
 * Achievements — deterministic checks over the player profile plus a
 * per-completion context. Rewards are TOOL charges (Time Freeze / Wire
 * Cutter), making achievements the tool economy's only faucet.
 *
 * Checks are pure so the exact same logic runs server-side (authoritative,
 * Redis-backed) and client-side (local fallback when no server is present).
 */

export type ToolId = 'freeze' | 'cutter';

export type ToolWallet = {
  freeze: number;
  cutter: number;
};

export type Achievement = {
  id: string;
  name: string;
  description: string;
  /** Tool charges granted on unlock. */
  reward: Partial<ToolWallet>;
};

/** Extra context about the completion that just happened. */
export type CompletionContext = {
  levelId: string;
  /** Fraction of the clock remaining at the win, 0..1. */
  timeLeftPct: number;
  /** Longest cascade chain achieved this level (0 = no chain). */
  maxChain: number;
  /** True if no tools were used this level. */
  noTools: boolean;
  /** True if the completed level was a boss. */
  isBoss: boolean;
};

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'ach_first_blood',
    name: 'First Untangle',
    description: 'Clear your first level',
    reward: { freeze: 1 },
  },
  {
    id: 'ach_perfectionist',
    name: 'Perfectionist',
    description: 'Earn 3 stars on 5 levels',
    reward: { cutter: 1 },
  },
  ...WORLDS.map((w) => ({
    id: `ach_world_clear_${w.id}`,
    name: `${w.name} Cleared`,
    description: `Clear every level in ${w.name}`,
    reward: { freeze: 1, cutter: 1 },
  })),
  {
    id: 'ach_speed_demon',
    name: 'Speed Demon',
    description: 'Win with over 60% of the clock left',
    reward: { freeze: 1 },
  },
  {
    id: 'ach_chain_x3',
    name: 'Chain Reaction',
    description: 'Trigger a 3-clear cascade chain',
    reward: { cutter: 1 },
  },
  {
    id: 'ach_streak_3',
    name: 'Regular',
    description: 'Complete the Daily Tangle 3 days in a row',
    reward: { freeze: 2 },
  },
  {
    id: 'ach_no_tools',
    name: 'Purist',
    description: 'Beat a boss without using any tools',
    reward: { cutter: 2 },
  },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function getAchievement(id: string): Achievement | undefined {
  return BY_ID.get(id);
}

/** True if every level of the given world has been cleared. */
function worldCleared(profile: PlayerProfile, world: number): boolean {
  for (let i = 1; i <= LEVELS_PER_WORLD; i++) {
    if (!profile.levels[`w${world}-${i}`]) return false;
  }
  return true;
}

/**
 * Returns achievement ids newly unlocked given the updated profile and the
 * completion that just happened. Already-unlocked ids are skipped.
 */
export function checkAchievements(
  profile: PlayerProfile,
  ctx: CompletionContext | null
): string[] {
  const owned = new Set(profile.achievements ?? []);
  const unlocked: string[] = [];
  const grant = (id: string): void => {
    if (!owned.has(id)) {
      owned.add(id);
      unlocked.push(id);
    }
  };

  const clears = Object.keys(profile.levels).filter((id) =>
    CAMPAIGN.some((l) => l.id === id)
  ).length;
  if (clears >= 1) grant('ach_first_blood');

  const threeStars = Object.values(profile.levels).filter((p) => p.stars >= 3).length;
  if (threeStars >= 5) grant('ach_perfectionist');

  for (const w of WORLDS) {
    if (worldCleared(profile, w.id)) grant(`ach_world_clear_${w.id}`);
  }

  if (ctx) {
    if (ctx.timeLeftPct > 0.6) grant('ach_speed_demon');
    if (ctx.maxChain >= 2) grant('ach_chain_x3'); // chainIndex 2 = third clear in chain
    if (ctx.isBoss && ctx.noTools) grant('ach_no_tools');
  }

  if (profile.streak >= 3) grant('ach_streak_3');

  return unlocked;
}

/** Sums the tool rewards for a set of newly unlocked achievement ids. */
export function rewardsFor(ids: string[]): ToolWallet {
  const total: ToolWallet = { freeze: 0, cutter: 0 };
  for (const id of ids) {
    const a = BY_ID.get(id);
    if (!a) continue;
    total.freeze += a.reward.freeze ?? 0;
    total.cutter += a.reward.cutter ?? 0;
  }
  return total;
}
