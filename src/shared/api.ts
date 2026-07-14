import type { ToolWallet } from './achievements';
import type { PuzzleDefinition } from './types';

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
  /** The current user's Reddit snoovatar URL, or null if they have none. */
  avatarUrl: string | null;
  /** Set when this post is a user-generated level; the client boots into it. */
  ugc: UgcLevel | null;
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

/** One other player's public progress, for the social road map. */
export type RosterEntry = {
  username: string;
  /** The level id they're currently sitting on (where they left off), or null if finished. */
  levelId: string | null;
  totalStars: number;
  /** Their Reddit snoovatar URL, or null if they have none. */
  avatarUrl: string | null;
};

export type RosterResponse = {
  type: 'roster';
  /** Other players (self excluded), most-recently-active first. */
  players: RosterEntry[];
};

/** A user-generated level, stored server-side and attached to its Reddit post. */
export type UgcLevel = {
  name: string;
  creator: string;
  def: PuzzleDefinition;
};

export type PublishLevelRequest = {
  title: string;
  def: PuzzleDefinition;
};

export type PublishLevelResponse = {
  type: 'publish';
  url: string;
  postId: string;
};

export type ErrorResponse = {
  status: 'error';
  message: string;
};
