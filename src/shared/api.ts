import type { ToolWallet } from './achievements';

/** Per-level progress record. */
export type LevelProgress = {
  stars: number;
  bestMoves: number;
  /** Best completion time in seconds (lower is better). */
  bestTimeSec?: number;
};

/** The full player profile persisted server-side. */
export type PlayerProfile = {
  username: string;
  /** levelId -> progress */
  levels: Record<string, LevelProgress>;
  zipTies: number;
  totalStars: number;
  /** ISO date of last daily completion + current streak length. */
  lastDaily: string | null;
  streak: number;
  /** Consumable tool charges (earned via achievements). */
  tools: ToolWallet;
  /** Unlocked achievement ids. */
  achievements: string[];
};

export type InitResponse = {
  type: 'init';
  postId: string;
  profile: PlayerProfile;
  /** ISO date (UTC) of today's daily puzzle. */
  dailyDate: string;
  dailyDone: boolean;
};

export type LevelCompleteRequest = {
  levelId: string;
  moves: number;
  /** Completion time in seconds. */
  timeSec: number;
  /** Longest cascade chain index reached (0 = none). */
  maxChain: number;
  /** True if no tools were used. */
  noTools: boolean;
};

export type LevelCompleteResponse = {
  type: 'level-complete';
  stars: number;
  zipTiesEarned: number;
  /** Includes the time bonus, already added into zipTiesEarned. */
  timeBonus: number;
  /** Newly unlocked achievement ids (rewards already applied to profile). */
  unlocked: string[];
  profile: PlayerProfile;
};

export type DailyScoreRequest = {
  moves: number;
  timeMs: number;
};

export type DailyEntry = {
  username: string;
  moves: number;
  timeMs: number;
};

export type DailyScoreResponse = {
  type: 'daily-score';
  rank: number;
  total: number;
  top: DailyEntry[];
  zipTiesEarned: number;
  streak: number;
  /** Newly unlocked achievement ids (rewards already applied to profile). */
  unlocked: string[];
  profile: PlayerProfile;
};

export type ToolSpendRequest = {
  tool: 'freeze' | 'cutter';
};

export type ToolSpendResponse = {
  type: 'tool-spend';
  profile: PlayerProfile;
};

export type ErrorResponse = {
  status: 'error';
  message: string;
};
