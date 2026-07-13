import { CableGame } from './three/CableGame';
import { generatePuzzle } from '../shared/engine/LevelGenerator';
import type { Difficulty } from '../shared/types';

const canvas = document.getElementById('bg') as HTMLCanvasElement;
const hudEl = document.getElementById('hud') as HTMLDivElement;
const menuEl = document.getElementById('menu') as HTMLDivElement;
const winEl = document.getElementById('win') as HTMLDivElement;
const winStatsEl = document.getElementById('winStats') as HTMLDivElement;
const newBtn = document.getElementById('newBtn') as HTMLButtonElement;
const nextBtn = document.getElementById('nextBtn') as HTMLButtonElement;

const TIERS: Difficulty[] = ['easy', 'medium', 'hard', 'extreme', 'nightmare'];

let game: CableGame | null = null;
let baseDifficulty: Difficulty = 'medium';
let level = 1;
let optimalMoves = 0;

/** Difficulty ramps up one tier every 3 cleared levels, capped at nightmare. */
function effectiveDifficulty(): Difficulty {
  const base = TIERS.indexOf(baseDifficulty);
  const idx = Math.min(TIERS.length - 1, base + Math.floor((level - 1) / 3));
  return TIERS[idx]!;
}

function startLevel(): void {
  if (game) {
    game.dispose();
    game = null;
  }
  winEl.classList.add('hidden');
  menuEl.classList.add('hidden');
  newBtn.classList.remove('hidden');

  const difficulty = effectiveDifficulty();
  const puzzle = generatePuzzle({ difficulty, seed: (Date.now() ^ (level * 2654435761)) & 0xffffff });
  optimalMoves = puzzle.optimalMoves;
  const locked = puzzle.cables.reduce((n, c) => n + (c.lockA ? 1 : 0) + (c.lockB ? 1 : 0), 0);
  const lockNote = locked > 0 ? `  ·  ${locked} bolted` : '';
  hudEl.textContent = `Level ${level} · ${difficulty}${lockNote}`;

  game = new CableGame(canvas, puzzle, {
    onMove: (moves) => {
      hudEl.textContent = `Level ${level} · ${difficulty}  ·  Moves ${moves}${lockNote}`;
    },
    onWin: (moves) => {
      const par = moves <= optimalMoves ? '★ perfect route!' : `par ${optimalMoves}`;
      winStatsEl.textContent = `Level ${level} cleared in ${moves} moves  ·  ${par}`;
      winEl.classList.remove('hidden');
    },
  });
}

function chooseDifficulty(difficulty: Difficulty): void {
  baseDifficulty = difficulty;
  level = 1;
  startLevel();
}

function nextLevel(): void {
  level += 1;
  startLevel();
}

function showMenu(): void {
  if (game) {
    game.dispose();
    game = null;
  }
  winEl.classList.add('hidden');
  newBtn.classList.add('hidden');
  menuEl.classList.remove('hidden');
}

for (const btn of Array.from(menuEl.querySelectorAll<HTMLButtonElement>('[data-diff]'))) {
  btn.addEventListener('click', () => chooseDifficulty((btn.dataset.diff as Difficulty) ?? 'medium'));
}

newBtn.addEventListener('click', showMenu);
nextBtn.addEventListener('click', nextLevel);

showMenu();
