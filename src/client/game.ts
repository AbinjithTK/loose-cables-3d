/**
 * Loose Cables — client app controller.
 *
 * Screens: loading -> Cable Tower map -> play (HUD + win panel).
 * Progress syncs to the Devvit server (Redis); the app still works if the
 * server is unreachable (e.g. local preview) by falling back to a local
 * in-memory profile.
 */
import { CableGame, DEFAULT_THEME, type GameTheme } from './three/CableGame';
import {
  CAMPAIGN,
  LEVELS_PER_WORLD,
  WORLDS,
  generateCampaignLevel,
  getLevel,
  starsForClear,
  type CampaignLevel,
} from '../shared/levels/campaign';
import { generatePuzzle } from '../shared/engine/LevelGenerator';
import { hashStringToSeed } from '../shared/engine/rng';
import type { PuzzleDefinition } from '../shared/types';
import type {
  DailyScoreResponse,
  InitResponse,
  LevelCompleteResponse,
  PlayerProfile,
} from '../shared/api';
import { audio } from './audio/AudioBus';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const screenLoading = $<HTMLDivElement>('screen-loading');
const screenMap = $<HTMLDivElement>('screen-map');
const screenPlay = $<HTMLDivElement>('screen-play');
const canvas = $<HTMLCanvasElement>('game-canvas');

const totalStarsEl = $<HTMLSpanElement>('total-stars');
const totalTiesEl = $<HTMLSpanElement>('total-ties');
const muteBtn = $<HTMLButtonElement>('mute-btn');
const towerEl = $<HTMLDivElement>('tower');
const towerScroll = $<HTMLDivElement>('tower-scroll');
const dailyBtn = $<HTMLButtonElement>('daily-btn');
const dailyMeta = $<HTMLParagraphElement>('daily-meta');

const backBtn = $<HTMLButtonElement>('back-btn');
const restartBtn = $<HTMLButtonElement>('restart-btn');
const hudMoves = $<HTMLSpanElement>('hud-moves');
const hudPar = $<HTMLSpanElement>('hud-par');
const hudStars = $<HTMLDivElement>('hud-stars');
const levelToast = $<HTMLDivElement>('level-toast');
const toastName = $<HTMLHeadingElement>('toast-name');
const toastSub = $<HTMLParagraphElement>('toast-sub');

const winOverlay = $<HTMLDivElement>('win-overlay');
const winTitle = $<HTMLHeadingElement>('win-title');
const winFlavor = $<HTMLParagraphElement>('win-flavor');
const winStarsEl = $<HTMLDivElement>('win-stars');
const winMovesEl = $<HTMLSpanElement>('win-moves');
const winParEl = $<HTMLSpanElement>('win-par');
const winTies = $<HTMLDivElement>('win-ties');
const winTiesN = $<HTMLSpanElement>('win-ties-n');
const winRetryBtn = $<HTMLButtonElement>('win-retry-btn');
const winNextBtn = $<HTMLButtonElement>('win-next-btn');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Mode = { kind: 'campaign'; level: CampaignLevel } | { kind: 'daily'; dateIso: string };

let profile: PlayerProfile = {
  username: 'you',
  levels: {},
  zipTies: 0,
  totalStars: 0,
  lastDaily: null,
  streak: 0,
};
let serverAvailable = false;
let dailyDate = new Date().toISOString().slice(0, 10);
let dailyDone = false;

let game: CableGame | null = null;
let mode: Mode | null = null;
let currentPar = 0;
let levelStartAt = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const WIN_FLAVOR = [
  'The drawer closes. For now.',
  'Somewhere, an IT person sheds a single tear of joy.',
  'Untangled. Absolutely untangled.',
  'That cable had it coming.',
  'Order restored to the universe. This corner of it, anyway.',
  'You may now unplug responsibly.',
];

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function showScreen(el: HTMLDivElement): void {
  for (const s of [screenLoading, screenMap, screenPlay]) s.hidden = s !== el;
  // Retrigger the enter transition on every swap.
  el.classList.remove('enter');
  void el.offsetWidth; // reflow so the animation restarts
  el.classList.add('enter');
}

// ---------------------------------------------------------------------------
// Server sync (graceful fallback for local preview)
// ---------------------------------------------------------------------------

async function serverInit(): Promise<void> {
  try {
    const res = await fetch('/api/init');
    if (!res.ok) throw new Error('init failed');
    const data = (await res.json()) as InitResponse;
    if (data.type !== 'init') throw new Error('bad init');
    profile = data.profile;
    dailyDate = data.dailyDate;
    dailyDone = data.dailyDone;
    serverAvailable = true;
  } catch {
    serverAvailable = false;
  }
}

async function serverLevelComplete(levelId: string, moves: number): Promise<LevelCompleteResponse | null> {
  if (!serverAvailable) return null;
  try {
    const res = await fetch('/api/level-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ levelId, moves }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as LevelCompleteResponse;
    return data.type === 'level-complete' ? data : null;
  } catch {
    return null;
  }
}

async function serverDailyScore(moves: number, timeMs: number): Promise<DailyScoreResponse | null> {
  if (!serverAvailable) return null;
  try {
    const res = await fetch('/api/daily-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moves, timeMs }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as DailyScoreResponse;
    return data.type === 'daily-score' ? data : null;
  } catch {
    return null;
  }
}

/** Local fallback: apply a clear to the in-memory profile. */
function localLevelComplete(levelId: string, moves: number, par: number): { stars: number; ties: number } {
  const stars = starsForClear(moves, par);
  const existing = profile.levels[levelId];
  const firstClear = !existing;
  profile.levels[levelId] = {
    stars: Math.max(existing?.stars ?? 0, stars),
    bestMoves: Math.min(existing?.bestMoves ?? Infinity, moves),
  };
  let ties = firstClear ? 2 : 0;
  if (stars === 3) ties += 1;
  profile.zipTies += ties;
  profile.totalStars = Object.values(profile.levels).reduce((n, l) => n + l.stars, 0);
  return { stars, ties };
}

// ---------------------------------------------------------------------------
// Cable Tower map
// ---------------------------------------------------------------------------

function starGlyphs(stars: number): string {
  let out = '';
  for (let i = 0; i < 3; i++) {
    out += i < stars ? '<span>\u2605</span>' : '<span class="off">\u2605</span>';
  }
  return out;
}

/** The next uncleared, unlocked campaign level (for the "current" pulse). */
function currentLevelId(): string | null {
  for (const level of CAMPAIGN) {
    const world = WORLDS[level.world - 1]!;
    if (profile.totalStars < world.gateStars) continue;
    if (!profile.levels[level.id]) return level.id;
  }
  return null;
}

/** Update a wallet counter, bumping its pill when the value increases. */
function setWallet(el: HTMLSpanElement, value: number): void {
  const prev = parseInt(el.textContent ?? '0', 10);
  el.textContent = String(value);
  if (value > prev) {
    const pill = el.closest('.wallet');
    if (pill) {
      pill.classList.remove('bump');
      void (pill as HTMLElement).offsetWidth;
      pill.classList.add('bump');
    }
  }
}

function renderMap(): void {
  setWallet(totalStarsEl, profile.totalStars);
  setWallet(totalTiesEl, profile.zipTies);
  dailyBtn.textContent = dailyDone ? 'Done' : 'Play';
  dailyBtn.disabled = dailyDone;
  dailyMeta.textContent = dailyDone
    ? `Streak: ${profile.streak} day${profile.streak === 1 ? '' : 's'} — back tomorrow!`
    : 'One board. One shot. Whole subreddit.';

  const activeId = currentLevelId();
  towerEl.innerHTML = '';
  const zig = ['left', 'mid', 'right', 'mid'];

  for (const world of WORLDS) {
    const unlocked = profile.totalStars >= world.gateStars;
    const worldLevels = CAMPAIGN.filter((l) => l.world === world.id);
    const worldStars = worldLevels.reduce((n, l) => n + (profile.levels[l.id]?.stars ?? 0), 0);

    const section = document.createElement('section');
    section.className = `world${unlocked ? '' : ' locked'}`;

    const road = document.createElement('div');
    road.className = 'level-road';

    worldLevels.forEach((level, i) => {
      const row = document.createElement('div');
      row.className = `level-row ${level.isBoss ? 'mid' : zig[i % zig.length]}`;

      const prog = profile.levels[level.id];
      // A level is playable if the world is unlocked and it's the first level
      // or the previous level in the world is cleared.
      const prevCleared = i === 0 || !!profile.levels[worldLevels[i - 1]!.id];
      const playable = unlocked && (prevCleared || !!prog);

      const node = document.createElement('button');
      node.type = 'button';
      node.className = [
        'level-node',
        level.isBoss ? 'boss' : '',
        prog ? 'done' : '',
        !playable ? 'locked' : '',
        level.id === activeId ? 'current' : '',
      ].filter(Boolean).join(' ');
      node.disabled = !playable;
      node.style.setProperty('--i', String(i)); // staggered pop-in delay
      node.setAttribute('aria-label', `${level.name}${prog ? `, ${prog.stars} stars` : ''}`);
      node.innerHTML = `
        <span class="bubble">${level.isBoss ? '\u2620' : level.index}</span>
        <span class="stars">${prog ? starGlyphs(prog.stars) : ''}</span>
      `;
      node.addEventListener('click', () => {
        audio.play('sfx_ui_tap');
        startCampaignLevel(level);
      });

      row.appendChild(node);
      road.appendChild(row);
    });

    const banner = document.createElement('div');
    banner.className = 'world-banner';
    banner.style.background = `linear-gradient(90deg, ${world.sky[1]}, ${world.sky[0]})`;
    banner.innerHTML = `
      <div class="world-num">${unlocked ? world.id : '\u{1F512}'}</div>
      <div>
        <h2>${world.name}</h2>
        <p>${world.tagline}</p>
      </div>
      <div class="world-stars">\u2605 ${worldStars}/${worldLevels.length * 3}</div>
    `;

    section.appendChild(road);
    section.appendChild(banner);
    if (!unlocked) {
      const note = document.createElement('p');
      note.className = 'world-lock-note';
      note.textContent = `Earn \u2605 ${world.gateStars} total stars to unlock (you have ${profile.totalStars}).`;
      section.appendChild(note);
    }
    towerEl.appendChild(section);
  }
}

function showMap(): void {
  disposeGame();
  winOverlay.hidden = true;
  renderMap();
  showScreen(screenMap);
  // Scroll to the current level's world (bottom = world 1). Scroll ONLY the
  // tower container — scrollIntoView would also scroll the overflow:hidden
  // screen wrapper and push the header off-screen.
  requestAnimationFrame(() => {
    const current = towerEl.querySelector<HTMLElement>('.level-node.current');
    if (current) {
      const nodeRect = current.getBoundingClientRect();
      const scrollRect = towerScroll.getBoundingClientRect();
      towerScroll.scrollTop +=
        nodeRect.top + nodeRect.height / 2 - (scrollRect.top + scrollRect.height / 2);
    } else {
      towerScroll.scrollTop = towerScroll.scrollHeight;
    }
  });
}

// ---------------------------------------------------------------------------
// Playing a level
// ---------------------------------------------------------------------------

function disposeGame(): void {
  if (game) {
    game.dispose();
    game = null;
  }
}

function projectedStars(moves: number): number {
  if (moves <= currentPar) return 3;
  if (moves <= currentPar + Math.ceil(currentPar / 2)) return 2;
  return 1;
}

let lastProjected = 3;

function updateHud(moves: number): void {
  hudMoves.textContent = String(moves);
  hudMoves.classList.toggle('over-par', moves > currentPar);

  // Bump the counter on every move.
  if (moves > 0) {
    hudMoves.classList.remove('bump');
    void hudMoves.offsetWidth;
    hudMoves.classList.add('bump');
  }

  // Shake the star pill when a projected star is lost.
  const projected = moves === 0 ? 3 : projectedStars(moves);
  hudStars.innerHTML = starGlyphs(projected);
  if (projected < lastProjected) {
    hudStars.classList.remove('shake');
    void hudStars.offsetWidth;
    hudStars.classList.add('shake');
  }
  lastProjected = projected;
}

function showToast(name: string, sub: string): void {
  if (toastTimer) clearTimeout(toastTimer);
  toastName.textContent = name;
  toastSub.textContent = sub;
  levelToast.hidden = false;
  levelToast.classList.remove('hide');
  toastTimer = setTimeout(() => {
    levelToast.classList.add('hide');
    toastTimer = setTimeout(() => {
      levelToast.hidden = true;
    }, 420);
  }, 2400);
}

function chainCallout(chainIndex: number): void {
  if (chainIndex < 1) return;
  const el = document.createElement('div');
  el.className = 'chain-callout';
  el.textContent = chainIndex === 1 ? 'CHAIN x2!' : `CHAIN x${chainIndex + 1}!`;
  screenPlay.appendChild(el);
  setTimeout(() => el.remove(), 850);
}

function launchPuzzle(puzzle: PuzzleDefinition, theme: GameTheme, toastTitle: string, toastSubText: string): void {
  disposeGame();
  winOverlay.hidden = true;
  currentPar = puzzle.optimalMoves;
  hudPar.textContent = String(currentPar);
  updateHud(0);
  showScreen(screenPlay);
  showToast(toastTitle, toastSubText);
  levelStartAt = performance.now();

  game = new CableGame(canvas, puzzle, {
    onMove: (moves) => updateHud(moves),
    onGrab: () => audio.play('sfx_plug_grab'),
    onDeny: () => audio.play('sfx_plug_deny'),
    onSnap: () => audio.play('sfx_plug_snap'),
    onClear: (chainIndex) => {
      audio.play('sfx_cable_resolve', { volume: 0.7 });
      audio.play('sfx_resolve_pop', { pitch: Math.min(chainIndex, 6) * 2 });
      if (chainIndex >= 1) {
        audio.play('sfx_cascade', { pitch: Math.min(chainIndex, 6) * 2 });
        chainCallout(chainIndex);
      }
    },
    onWin: (moves) => void handleWin(moves),
  }, theme);
}

function startCampaignLevel(level: CampaignLevel): void {
  const world = WORLDS[level.world - 1]!;
  mode = { kind: 'campaign', level };
  const puzzle = generateCampaignLevel(level);
  launchPuzzle(
    puzzle,
    world,
    `${level.isBoss ? '\u2620 BOSS: ' : ''}${level.name}`,
    `${world.name} \u2022 Level ${level.index}/${LEVELS_PER_WORLD} \u2022 Par ${puzzle.optimalMoves}`
  );
}

function startDaily(): void {
  mode = { kind: 'daily', dateIso: dailyDate };
  const puzzle = generatePuzzle({
    difficulty: 'medium',
    seed: hashStringToSeed(`daily:${dailyDate}`),
    name: "Today's Tangle",
    scene: 'strip',
  });
  launchPuzzle(
    puzzle,
    DEFAULT_THEME,
    "Today's Tangle",
    `${dailyDate} \u2022 Par ${puzzle.optimalMoves} \u2022 One attempt counts`
  );
}

// ---------------------------------------------------------------------------
// Win handling
// ---------------------------------------------------------------------------

async function handleWin(moves: number): Promise<void> {
  if (!mode) return;
  const timeMs = Math.round(performance.now() - levelStartAt);
  audio.play('sfx_level_win');

  let stars = projectedStars(moves);
  let ties = 0;
  let subtitle = WIN_FLAVOR[Math.floor(Math.random() * WIN_FLAVOR.length)]!;
  let nextLabel = 'Next';

  if (mode.kind === 'campaign') {
    const levelId = mode.level.id;
    const server = await serverLevelComplete(levelId, moves);
    if (server) {
      stars = server.stars;
      ties = server.zipTiesEarned;
      profile = server.profile;
    } else {
      const local = localLevelComplete(levelId, moves, currentPar);
      stars = local.stars;
      ties = local.ties;
    }
    winTitle.textContent = mode.level.isBoss ? 'BOSS DEFEATED!' : 'Level Clear!';
    if (mode.level.isBoss) {
      subtitle = 'The tower rumbles. A new floor unlocks above\u2026';
      audio.play('sfx_world_unlock');
    }
  } else {
    const server = await serverDailyScore(moves, timeMs);
    dailyDone = true;
    if (server) {
      ties = server.zipTiesEarned;
      profile = server.profile;
      subtitle = `Rank #${server.rank} of ${server.total} today \u2022 streak ${server.streak}`;
      if (server.streak > 1) audio.play('sfx_streak_flame');
    } else {
      profile.streak += 1;
      profile.lastDaily = dailyDate;
      ties = 3;
      profile.zipTies += ties;
      subtitle = `Cleared in ${moves} moves \u2022 streak ${profile.streak}`;
    }
    winTitle.textContent = 'Tangle Untangled!';
    nextLabel = 'Tower';
  }

  // Populate panel.
  winFlavor.textContent = subtitle;
  winMovesEl.textContent = String(moves);
  winParEl.textContent = String(currentPar);
  winNextBtn.textContent = nextLabel;
  winTies.hidden = ties <= 0;
  winTiesN.textContent = String(ties);
  if (ties > 0) setTimeout(() => audio.play('sfx_ziptie_earn'), 1400);

  // Star pop sequence.
  const starEls = Array.from(winStarsEl.querySelectorAll<HTMLSpanElement>('.star'));
  for (const el of starEls) el.classList.remove('on', 'pop');
  winOverlay.hidden = false;
  starEls.forEach((el, i) => {
    if (i >= stars) return;
    setTimeout(() => {
      el.classList.add('on', 'pop');
      audio.play('sfx_star_award', { pitch: i * 3 });
    }, 500 + i * 320);
  });
}

function nextAfterWin(): void {
  audio.play('sfx_ui_tap');
  if (mode?.kind === 'campaign') {
    const level = mode.level;
    const next = getLevel(`w${level.world}-${level.index + 1}`) ?? getLevel(`w${level.world + 1}-1`);
    if (next) {
      const nextWorld = WORLDS[next.world - 1]!;
      const unlocked = profile.totalStars >= nextWorld.gateStars;
      if (unlocked) {
        startCampaignLevel(next);
        return;
      }
    }
  }
  showMap();
}

// ---------------------------------------------------------------------------
// Wire up UI
// ---------------------------------------------------------------------------

backBtn.addEventListener('click', () => {
  audio.play('sfx_ui_tap');
  showMap();
});

restartBtn.addEventListener('click', () => {
  audio.play('sfx_ui_tap');
  if (mode?.kind === 'campaign') startCampaignLevel(mode.level);
  else if (mode?.kind === 'daily') startDaily();
});

winRetryBtn.addEventListener('click', () => {
  audio.play('sfx_ui_tap');
  if (mode?.kind === 'campaign') startCampaignLevel(mode.level);
  else showMap();
});

winNextBtn.addEventListener('click', nextAfterWin);

dailyBtn.addEventListener('click', () => {
  if (dailyDone) return;
  audio.play('sfx_ui_tap');
  startDaily();
});

muteBtn.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  muteBtn.textContent = audio.muted ? '\u{1D13D}' : '\u266B';
  muteBtn.setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound');
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  showScreen(screenLoading);
  await serverInit();
  showMap();
}

void boot();
