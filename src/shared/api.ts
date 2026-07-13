/** Per-level progress record. */
export type LevelProgress = {
  stars: number;
  bestMoves: number;
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
};

export type LevelCompleteResponse = {
  type: 'level-complete';
  stars: number;
  zipTiesEarned: number;
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
  profile: PlayerProfile;
};

export type ErrorResponse = {
  status: 'error';
  message: string;
};
