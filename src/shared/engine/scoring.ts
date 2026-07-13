/**
 * Scoring for Loose Cables.
 *
 * Lower scores are better (they rank first on the leaderboard). The score is a
 * time value in milliseconds, inflated by inefficiency and undo penalties. A
 * perfect solve (optimal move count, no undos) equals the raw elapsed time.
 */

/** Milliseconds added to the effective time for each undo used. */
export const UNDO_PENALTY_MS = 3000;

export type ScoreInput = {
  elapsedMs: number;
  moveCount: number;
  undoCount: number;
  optimalMoves: number;
};

export type ScoreResult = {
  /** Final sortable score (lower is better). */
  score: number;
  /** 0-100, how close to optimal the move count was. */
  efficiency: number;
  /** Effective time after undo penalties, before efficiency scaling. */
  adjustedMs: number;
};

/**
 * Efficiency as a percentage. optimalMoves/actualMoves, clamped to [1, 100].
 * If the player somehow beats the recorded optimal (shouldn't happen, but be
 * safe), efficiency caps at 100 rather than exceeding it.
 */
export function computeEfficiency(moveCount: number, optimalMoves: number): number {
  if (moveCount <= 0) return 100;
  const raw = (optimalMoves / moveCount) * 100;
  return Math.max(1, Math.min(100, Math.round(raw)));
}

export function computeScore(input: ScoreInput): ScoreResult {
  const { elapsedMs, moveCount, undoCount, optimalMoves } = input;
  const adjustedMs = elapsedMs + undoCount * UNDO_PENALTY_MS;
  const efficiency = computeEfficiency(moveCount, optimalMoves);
  // Scale time by inverse efficiency: at 100% efficiency the score equals the
  // adjusted time; at 50% efficiency it doubles.
  const score = Math.round(adjustedMs * (100 / efficiency));
  return { score, efficiency, adjustedMs };
}

/** Formats a millisecond duration as M:SS.mmm for HUD/leaderboard display. */
export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);
  const pad = (n: number, width: number) => n.toString().padStart(width, '0');
  return `${minutes}:${pad(seconds, 2)}.${pad(millis, 3)}`;
}
