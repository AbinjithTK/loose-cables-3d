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
  nextLevelId,
  starsForClear,
  timeBonusTies,
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
  RosterEntry,
  RosterResponse,
  ToolSpendResponse,
} from '../shared/api';
import {
  ACHIEVEMENTS,
  checkAchievements,
  getAchievement,
  rewardsFor,
  type CompletionContext,
} from '../shared/achievements';
import { audio } from './audio/AudioBus';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const screenLoading = $<HTMLDivElement>('screen-loading');
const screenHome = $<HTMLDivElement>('screen-home');
const screenMap = $<HTMLDivElement>('screen-map');
const screenPlay = $<HTMLDivElement>('screen-play');
const canvas = $<HTMLCanvasElement>('game-canvas');

// Home / menu
const homeUsernameEl = $<HTMLElement>('home-username');
const homeAvatarEl = $<HTMLSpanElement>('home-avatar');
const homeStarsEl = $<HTMLSpanElement>('home-stars');
const homeStreakEl = $<HTMLSpanElement>('home-streak');
const homeTiesEl = $<HTMLSpanElement>('home-ties');
const homeProgressEl = $<HTMLParagraphElement>('home-progress');
const homePlayBtn = $<HTMLButtonElement>('home-play-btn');
const homeDailyBtn = $<HTMLButtonElement>('home-daily-btn');
const homeMuteBtn = $<HTMLButtonElement>('home-mute-btn');
const mapHomeBtn = $<HTMLButtonElement>('map-home-btn');

const totalStarsEl = $<HTMLSpanElement>('total-stars');
const totalTiesEl = $<HTMLSpanElement>('total-ties');
const totalFreezeEl = $<HTMLSpanElement>('total-freeze');
const totalCutterEl = $<HTMLSpanElement>('total-cutter');
const muteBtn = $<HTMLButtonElement>('mute-btn');
const towerEl = $<HTMLDivElement>('tower');
const towerScroll = $<HTMLDivElement>('tower-scroll');
const dailyBtn = $<HTMLButtonElement>('daily-btn');
const dailyMeta = $<HTMLParagraphElement>('daily-meta');
const mapAchBtn = $<HTMLButtonElement>('map-ach-btn');

// Achievements page
const screenAchievements = $<HTMLDivElement>('screen-achievements');
const achList = $<HTMLDivElement>('ach-list');
const achEarnedN = $<HTMLSpanElement>('ach-earned-n');
const achTotalN = $<HTMLSpanElement>('ach-total-n');
const achBackBtn = $<HTMLButtonElement>('ach-back-btn');
const homeAchBtn = $<HTMLButtonElement>('home-ach-btn');

const backBtn = $<HTMLButtonElement>('back-btn');
const restartBtn = $<HTMLButtonElement>('restart-btn');
const hudMoves = $<HTMLSpanElement>('hud-moves');
const hudPar = $<HTMLSpanElement>('hud-par');
const hudStars = $<HTMLDivElement>('hud-stars');
const hudTimer = $<HTMLDivElement>('hud-timer');
const hudTime = $<HTMLSpanElement>('hud-time');
const levelToast = $<HTMLDivElement>('level-toast');
const toastName = $<HTMLHeadingElement>('toast-name');
const toastSub = $<HTMLParagraphElement>('toast-sub');

// Tools
const toolbar = $<HTMLDivElement>('toolbar');
const toolFreezeBtn = $<HTMLButtonElement>('tool-freeze');
const toolFreezeN = $<HTMLSpanElement>('tool-freeze-n');
const toolFreezeRing = toolFreezeBtn.querySelector<SVGCircleElement>('.tool-ring circle');
const toolCutterBtn = $<HTMLButtonElement>('tool-cutter');
const toolCutterN = $<HTMLSpanElement>('tool-cutter-n');
const cutHint = $<HTMLDivElement>('cut-hint');
const zapFlash = $<HTMLDivElement>('zap-flash');

// Tutorial + achievement toast
const tutorialOverlay = $<HTMLDivElement>('tutorial-overlay');
const tutorialIcon = $<HTMLDivElement>('tutorial-icon');
const tutorialTitle = $<HTMLHeadingElement>('tutorial-title');
const tutorialBody = $<HTMLParagraphElement>('tutorial-body');
const tutorialOkBtn = $<HTMLButtonElement>('tutorial-ok-btn');
const achievementToast = $<HTMLDivElement>('achievement-toast');
const achName = $<HTMLElement>('ach-name');
const achReward = $<HTMLElement>('ach-reward');

// Game over
const gameoverOverlay = $<HTMLDivElement>('gameover-overlay');
const gameoverMapBtn = $<HTMLButtonElement>('gameover-map-btn');
const gameoverRetryBtn = $<HTMLButtonElement>('gameover-retry-btn');

const winOverlay = $<HTMLDivElement>('win-overlay');
const winTitle = $<HTMLHeadingElement>('win-title');
const winFlavor = $<HTMLParagraphElement>('win-flavor');
const winStarsEl = $<HTMLDivElement>('win-stars');
const winMovesEl = $<HTMLSpanElement>('win-moves');
const winParEl = $<HTMLSpanElement>('win-par');
const winTimeEl = $<HTMLSpanElement>('win-time');
const winTies = $<HTMLDivElement>('win-ties');
const winTiesN = $<HTMLSpanElement>('win-ties-n');
const winBonus = $<HTMLDivElement>('win-bonus');
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
  tools: { freeze: 0, cutter: 0 },
  achievements: [],
};
let serverAvailable = false;
let dailyDate = new Date().toISOString().slice(0, 10);
let dailyDone = false;

// Other players and where they left off (keyed by levelId for map pins).
let rosterByLevel = new Map<string, RosterEntry[]>();
// The current user's own snoovatar URL (null if they have none).
let myAvatarUrl: string | null = null;

let game: CableGame | null = null;
let mode: Mode | null = null;
let currentPar = 0;
let levelStartAt = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

// -- Timer / tools / mechanics state ----------------------------------------
const FREEZE_MS = 15_000;
let timeLimitSec = 0;
let timeLeftMs = 0;
let timerActive = false;
let timerLastTs = 0;
let freezeEndsAt = 0; // performance.now() ms; clock is frozen until then
let overlayPaused = false; // tutorial open -> clock paused
let surgeSchedule: number[] = []; // timeLeftMs thresholds (descending) to fire a surge
let maxChainReached = 0;
let noToolsUsed = true;
let cutArmed = false;
let lowTimeWarned = false;

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
  for (const s of [screenLoading, screenHome, screenMap, screenAchievements, screenPlay]) {
    s.hidden = s !== el;
  }
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
    myAvatarUrl = data.avatarUrl ?? null;
    serverAvailable = true;
  } catch {
    serverAvailable = false;
  }
}

async function serverLevelComplete(
  levelId: string,
  moves: number,
  timeSec: number,
  maxChain: number,
  noTools: boolean
): Promise<LevelCompleteResponse | null> {
  if (!serverAvailable) return null;
  try {
    const res = await fetch('/api/level-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ levelId, moves, timeSec, maxChain, noTools }),
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

/** Local fallback: apply a clear to the in-memory profile (+ offline achievements). */
function localLevelComplete(
  levelId: string,
  moves: number,
  par: number,
  timeBonus: number,
  ctx: CompletionContext
): { stars: number; ties: number; unlocked: string[] } {
  const stars = starsForClear(moves, par);
  const existing = profile.levels[levelId];
  const firstClear = !existing;
  profile.levels[levelId] = {
    stars: Math.max(existing?.stars ?? 0, stars),
    bestMoves: Math.min(existing?.bestMoves ?? Infinity, moves),
  };
  let ties = firstClear ? 2 : 0;
  if (stars === 3) ties += 1;
  ties += timeBonus;
  profile.zipTies += ties;
  profile.totalStars = Object.values(profile.levels).reduce((n, l) => n + l.stars, 0);

  const unlocked = checkAchievements(profile, ctx);
  if (unlocked.length > 0) {
    profile.achievements = [...profile.achievements, ...unlocked];
    const reward = rewardsFor(unlocked);
    profile.tools.freeze += reward.freeze;
    profile.tools.cutter += reward.cutter;
  }
  return { stars, ties, unlocked };
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
  return nextLevelId(new Set(Object.keys(profile.levels)), profile.totalStars);
}

// ---------------------------------------------------------------------------
// Reddit identity + social roster
// ---------------------------------------------------------------------------

/** A stable, pleasant color derived from a username. */
function userColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 70%, 62%)`;
}

function displayName(): string {
  const u = profile.username;
  return !u || u === 'you' || u === 'anonymous' ? 'guest' : u;
}

/** Builds an avatar element: snoovatar image if available, else a colored initial. */
function buildAvatarPin(
  entry: { username: string; avatarUrl: string | null; totalStars?: number },
  isYou: boolean
): HTMLElement {
  const pin = document.createElement('span');
  pin.className = `player-pin${isYou ? ' you' : ''}`;
  const setInitial = (): void => {
    pin.classList.remove('has-img');
    pin.style.background = userColor(entry.username);
    pin.textContent = entry.username.slice(0, 1);
  };
  if (entry.avatarUrl) {
    pin.classList.add('has-img');
    const img = document.createElement('img');
    img.src = entry.avatarUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', setInitial); // graceful fallback if the URL fails
    pin.appendChild(img);
  } else {
    setInitial();
  }
  pin.title = isYou
    ? `You \u2022 u/${entry.username}`
    : `u/${entry.username}${entry.totalStars != null ? ` \u2022 \u2605 ${entry.totalStars}` : ''}`;
  return pin;
}

async function fetchRoster(): Promise<void> {
  rosterByLevel = new Map();
  if (!serverAvailable) return;
  try {
    const res = await fetch('/api/roster');
    if (!res.ok) return;
    const data = (await res.json()) as RosterResponse;
    if (data.type !== 'roster') return;
    for (const p of data.players) {
      if (!p.levelId) continue;
      const list = rosterByLevel.get(p.levelId) ?? [];
      list.push(p);
      rosterByLevel.set(p.levelId, list);
    }
  } catch {
    /* roster is best-effort */
  }
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

function rewardText(a: (typeof ACHIEVEMENTS)[number]): string {
  const parts: string[] = [];
  if (a.reward.freeze) parts.push(`\u2744 +${a.reward.freeze}`);
  if (a.reward.cutter) parts.push(`\u2702 +${a.reward.cutter}`);
  return parts.join('  ');
}

/** Renders the full Achievements page (earned + locked, with rewards). */
function renderAchievements(): void {
  const owned = new Set(profile.achievements ?? []);
  achEarnedN.textContent = String([...owned].filter((id) => getAchievement(id)).length);
  achTotalN.textContent = String(ACHIEVEMENTS.length);
  achList.innerHTML = '';
  for (const a of ACHIEVEMENTS) {
    const earned = owned.has(a.id);
    const row = document.createElement('div');
    row.className = `ach-row${earned ? ' earned' : ''}`;
    const reward = rewardText(a);
    row.innerHTML = `
      <div class="ach-row-badge">${earned ? '\u{1F3C6}' : '\u{1F512}'}</div>
      <div class="ach-row-text">
        <span class="ach-row-name">${a.name}</span>
        <span class="ach-row-desc">${a.description}</span>
      </div>
      <span class="ach-row-reward">${reward}</span>
    `;
    achList.appendChild(row);
  }
}

let achReturnScreen: HTMLDivElement = screenHome;

function openAchievements(from: HTMLDivElement): void {
  achReturnScreen = from;
  renderAchievements();
  showScreen(screenAchievements);
}

function renderMap(): void {
  setWallet(totalStarsEl, profile.totalStars);
  setWallet(totalTiesEl, profile.zipTies);
  setWallet(totalFreezeEl, profile.tools.freeze);
  setWallet(totalCutterEl, profile.tools.cutter);
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

      // Social pins: you (at your current level) + other players sitting here.
      const here = rosterByLevel.get(level.id) ?? [];
      const isCurrent = level.id === activeId;
      if (here.length > 0 || isCurrent) {
        const pins = document.createElement('div');
        pins.className = 'player-pins';
        if (isCurrent) {
          pins.appendChild(
            buildAvatarPin({ username: displayName(), avatarUrl: myAvatarUrl }, true)
          );
        }
        for (const p of here.slice(0, 4)) pins.appendChild(buildAvatarPin(p, false));
        if (here.length > 4) {
          const more = document.createElement('span');
          more.className = 'player-pin more';
          more.textContent = `+${here.length - 4}`;
          more.title = here.slice(4).map((p) => `u/${p.username}`).join(', ');
          pins.appendChild(more);
        }
        row.appendChild(pins);
      }

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

function renderHome(): void {
  homeUsernameEl.textContent = `u/${displayName()}`;
  if (myAvatarUrl) {
    homeAvatarEl.classList.add('has-img');
    homeAvatarEl.innerHTML = `<img src="${myAvatarUrl}" alt="" />`;
  } else {
    homeAvatarEl.classList.remove('has-img');
    homeAvatarEl.textContent = displayName().slice(0, 1);
  }
  homeStarsEl.textContent = String(profile.totalStars);
  homeStreakEl.textContent = String(profile.streak);
  homeTiesEl.textContent = String(profile.zipTies);

  const cur = currentLevelId();
  const anyProgress = Object.keys(profile.levels).length > 0;
  if (!cur) {
    homePlayBtn.textContent = 'Play Again';
    homeProgressEl.textContent = 'You cleared the whole tower. Legend.';
  } else {
    const level = getLevel(cur)!;
    const world = WORLDS[level.world - 1]!;
    homePlayBtn.textContent = anyProgress ? 'Continue' : 'Start Playing';
    homeProgressEl.textContent = anyProgress
      ? `Next up: ${world.name} \u2022 ${level.name}`
      : `Begin in ${world.name}`;
  }
  homeDailyBtn.textContent = dailyDone ? 'Daily Done \u2713' : "Today's Tangle";
  homeDailyBtn.disabled = dailyDone;
}

function showHome(): void {
  stopLevelTimer();
  disarmCut();
  disposeGame();
  winOverlay.hidden = true;
  gameoverOverlay.hidden = true;
  tutorialOverlay.hidden = true;
  renderHome();
  showScreen(screenHome);
}

/** Refresh the social roster in the background, then re-render the map pins. */
async function refreshRosterAndMap(): Promise<void> {
  await fetchRoster();
  if (!screenMap.hidden) renderMap();
}

function showMap(): void {
  stopLevelTimer();
  disarmCut();
  disposeGame();
  winOverlay.hidden = true;
  gameoverOverlay.hidden = true;
  tutorialOverlay.hidden = true;
  renderMap();
  void refreshRosterAndMap();
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

type TimerOpts = { limitSec: number; surgeCount: number };

function launchPuzzle(
  puzzle: PuzzleDefinition,
  theme: GameTheme,
  toastTitle: string,
  toastSubText: string,
  timed: TimerOpts | null
): void {
  disposeGame();
  winOverlay.hidden = true;
  gameoverOverlay.hidden = true;
  disarmCut();
  maxChainReached = 0;
  noToolsUsed = true;
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
      maxChainReached = Math.max(maxChainReached, chainIndex);
      audio.play('sfx_cable_resolve', { volume: 0.7 });
      audio.play('sfx_resolve_pop', { pitch: Math.min(chainIndex, 6) * 2 });
      if (chainIndex >= 1) {
        audio.play('sfx_cascade', { pitch: Math.min(chainIndex, 6) * 2 });
        chainCallout(chainIndex);
      }
    },
    onZap: () => {
      audio.play('sfx_zap');
      flashScreen('zap');
    },
    onCut: () => onCableCut(),
    onSurge: () => flashScreen('surge'),
    onWin: (moves) => void handleWin(moves),
  }, theme);

  // Timed (campaign) vs untimed (daily practice).
  if (timed) {
    hudTimer.style.display = '';
    toolbar.style.display = 'flex';
    updateToolUi();
    startLevelTimer(timed.limitSec, timed.surgeCount);
  } else {
    stopLevelTimer();
    hudTimer.style.display = 'none';
    toolbar.style.display = 'none';
  }
}

function startCampaignLevel(level: CampaignLevel): void {
  const world = WORLDS[level.world - 1]!;
  mode = { kind: 'campaign', level };
  const puzzle = generateCampaignLevel(level);
  // Bosses in the Nightmare Datacenter surge twice; other surge levels once.
  const surgeCount = level.mechanics.surge ? (level.isBoss ? 2 : 1) : 0;
  launchPuzzle(
    puzzle,
    world,
    `${level.isBoss ? '\u2620 BOSS: ' : ''}${level.name}`,
    `${world.name} \u2022 Level ${level.index}/${LEVELS_PER_WORLD} \u2022 Par ${puzzle.optimalMoves}`,
    { limitSec: level.timeLimit, surgeCount }
  );
  queueTutorials(level, puzzle);
}

function startDaily(): void {
  mode = { kind: 'daily', dateIso: dailyDate };
  const puzzle = generatePuzzle({
    difficulty: 'medium',
    seed: hashStringToSeed(`daily:${dailyDate}`),
    name: "Today's Tangle",
    scene: 'strip',
  });
  // Daily is a relaxed practice board: no countdown, no tools.
  launchPuzzle(
    puzzle,
    DEFAULT_THEME,
    "Today's Tangle",
    `${dailyDate} \u2022 Par ${puzzle.optimalMoves} \u2022 One attempt counts`,
    null
  );
}

// ---------------------------------------------------------------------------
// Countdown timer + power surges
// ---------------------------------------------------------------------------

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function startLevelTimer(limitSec: number, surgeCount: number): void {
  timeLimitSec = limitSec;
  timeLeftMs = limitSec * 1000;
  freezeEndsAt = 0;
  overlayPaused = false;
  lowTimeWarned = false;
  // Evenly space surges across the level (never at the very start or end).
  surgeSchedule = [];
  for (let i = 1; i <= surgeCount; i++) {
    surgeSchedule.push(limitSec * 1000 * (1 - i / (surgeCount + 1)));
  }
  timerLastTs = performance.now();
  timerActive = true;
  updateTimerUi(false);
  requestAnimationFrame(timerTick);
}

function stopLevelTimer(): void {
  timerActive = false;
}

function timerTick(ts: number): void {
  if (!timerActive) return;
  const dt = ts - timerLastTs;
  timerLastTs = ts;
  const frozen = ts < freezeEndsAt;

  if (!overlayPaused && !frozen) {
    timeLeftMs -= dt;

    // Fire any surges whose threshold we've crossed.
    while (surgeSchedule.length > 0 && timeLeftMs <= surgeSchedule[0]!) {
      surgeSchedule.shift();
      audio.play('sfx_surge_warning');
      flashScreen('surge');
      game?.triggerSurge();
    }

    const secLeft = timeLeftMs / 1000;
    if (secLeft <= 10 && !lowTimeWarned) {
      lowTimeWarned = true;
      audio.play('sfx_timer_tick');
    }

    if (timeLeftMs <= 0) {
      timeLeftMs = 0;
      updateTimerUi(false);
      handleGameOver();
      return;
    }
  }

  if (freezeEndsAt && ts >= freezeEndsAt) {
    freezeEndsAt = 0;
    toolFreezeBtn.classList.remove('active');
    if (toolFreezeRing) toolFreezeRing.style.strokeDashoffset = '';
  }

  updateTimerUi(frozen);
  requestAnimationFrame(timerTick);
}

function updateTimerUi(frozen: boolean): void {
  hudTime.textContent = formatClock(timeLeftMs);
  const sec = timeLeftMs / 1000;
  hudTimer.classList.toggle('frozen', frozen);
  hudTimer.classList.toggle('warn', !frozen && sec <= 30 && sec > 10);
  hudTimer.classList.toggle('critical', !frozen && sec <= 10);
}

// ---------------------------------------------------------------------------
// Tools: Time Freeze + Wire Cutter
// ---------------------------------------------------------------------------

function updateToolUi(): void {
  toolFreezeN.textContent = String(profile.tools.freeze);
  toolCutterN.textContent = String(profile.tools.cutter);
  const frozen = performance.now() < freezeEndsAt;
  toolFreezeBtn.disabled = profile.tools.freeze <= 0 || frozen;
  toolCutterBtn.disabled = profile.tools.cutter <= 0 && !cutArmed;
}

/** Optimistically spend a tool charge and persist it to the server. */
function spendTool(tool: 'freeze' | 'cutter'): void {
  if (profile.tools[tool] > 0) profile.tools[tool] -= 1;
  noToolsUsed = false;
  updateToolUi();
  if (!serverAvailable) return;
  void fetch('/api/tool-spend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool }),
  })
    .then((r) => (r.ok ? (r.json() as Promise<ToolSpendResponse | { status: string }>) : null))
    .then((d) => {
      if (d && 'type' in d && d.type === 'tool-spend') {
        profile = d.profile;
        updateToolUi();
      }
    })
    .catch(() => {});
}

function useFreeze(): void {
  if (!timerActive || profile.tools.freeze <= 0) return;
  const now = performance.now();
  if (now < freezeEndsAt) return; // already frozen
  spendTool('freeze');
  freezeEndsAt = now + FREEZE_MS;
  audio.play('sfx_freeze');
  toolFreezeBtn.classList.add('active');
  // Sweep the ring over the freeze duration.
  if (toolFreezeRing) {
    const c = 2 * Math.PI * 20;
    toolFreezeRing.style.strokeDasharray = String(c);
    toolFreezeRing.style.transition = 'none';
    toolFreezeRing.style.strokeDashoffset = '0';
    requestAnimationFrame(() => {
      toolFreezeRing.style.transition = `stroke-dashoffset ${FREEZE_MS}ms linear`;
      toolFreezeRing.style.strokeDashoffset = String(c);
    });
  }
}

function armCut(): void {
  if (!game) return;
  if (cutArmed) {
    disarmCut();
    return;
  }
  if (profile.tools.cutter <= 0) return;
  cutArmed = true;
  game.setCutMode(true);
  screenPlay.classList.add('cut-mode');
  toolCutterBtn.classList.add('armed');
  cutHint.hidden = false;
  audio.play('sfx_ui_tap');
}

function disarmCut(): void {
  cutArmed = false;
  game?.setCutMode(false);
  screenPlay.classList.remove('cut-mode');
  toolCutterBtn.classList.remove('armed');
  cutHint.hidden = true;
}

/** Called by the engine when a cable is actually cut — consume the charge. */
function onCableCut(): void {
  spendTool('cutter');
  disarmCut();
  audio.play('sfx_cut');
}

function flashScreen(kind: 'zap' | 'surge'): void {
  zapFlash.classList.remove('on');
  void zapFlash.offsetWidth;
  zapFlash.classList.add('on');
  if (kind === 'surge') hudTimer.classList.add('critical');
}

// ---------------------------------------------------------------------------
// Game over (ran out of time)
// ---------------------------------------------------------------------------

function handleGameOver(): void {
  stopLevelTimer();
  disarmCut();
  audio.play('sfx_time_up');
  gameoverOverlay.hidden = false;
}

// ---------------------------------------------------------------------------
// Mechanic tutorials (shown once per mechanic, tracked in localStorage)
// ---------------------------------------------------------------------------

type Tutorial = { key: string; icon: string; title: string; body: string };

const TUTORIALS: Record<string, Tutorial> = {
  bolted: {
    key: 'bolted',
    icon: '\u{1F529}',
    title: 'Bolted Ends',
    body: 'Some plugs are bolted down and cannot be moved. Route every other cable around them.',
  },
  golden: {
    key: 'golden',
    icon: '\u2728',
    title: 'The Golden Cable',
    body: 'The glowing gold cable settles LAST. Clear everything around it and it snaps free on its own.',
  },
  liveWire: {
    key: 'liveWire',
    icon: '\u26A1',
    title: 'Live Wire',
    body: 'The sparking cable is live. Grab it while it still crosses another and you take a +1 move zap. Free its path first.',
  },
  blackout: {
    key: 'blackout',
    icon: '\u{1F526}',
    title: 'Blackout',
    body: 'The lights are out. Move your pointer to sweep the flashlight across the board and find the tangle.',
  },
  surge: {
    key: 'surge',
    icon: '\u{1F329}',
    title: 'Power Surge',
    body: 'A surge will yank a cable to a new socket mid-level. Watch the flash and adapt fast.',
  },
  toolFreeze: {
    key: 'toolFreeze',
    icon: '\u2744',
    title: 'Time Freeze',
    body: 'Earned from achievements. Tap the snowflake to freeze the clock for 15 seconds.',
  },
  toolCutter: {
    key: 'toolCutter',
    icon: '\u2702',
    title: 'Wire Cutter',
    body: 'Earned from achievements. Tap the scissors, then tap any cable to cut it clean off the board.',
  },
};

const SEEN_KEY = 'lc3d.seenTutorials';

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function markSeen(seen: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore */
  }
}

let tutorialQueue: Tutorial[] = [];

function queueTutorials(level: CampaignLevel, puzzle: PuzzleDefinition): void {
  const seen = loadSeen();
  const keys: string[] = [];
  if (puzzle.cables.some((c) => c.lockA || c.lockB)) keys.push('bolted');
  if (level.mechanics.golden) keys.push('golden');
  if (level.mechanics.liveWire) keys.push('liveWire');
  if (level.mechanics.blackout) keys.push('blackout');
  if (level.mechanics.surge) keys.push('surge');
  if (profile.tools.freeze > 0) keys.push('toolFreeze');
  if (profile.tools.cutter > 0) keys.push('toolCutter');

  tutorialQueue = keys.filter((k) => !seen.has(k)).map((k) => TUTORIALS[k]!).filter(Boolean);
  if (tutorialQueue.length > 0) {
    overlayPaused = true;
    showNextTutorial();
  }
}

function showNextTutorial(): void {
  const t = tutorialQueue.shift();
  if (!t) {
    tutorialOverlay.hidden = true;
    overlayPaused = false;
    timerLastTs = performance.now(); // don't count paused time against the clock
    return;
  }
  tutorialIcon.textContent = t.icon;
  tutorialTitle.textContent = t.title;
  tutorialBody.textContent = t.body;
  tutorialOverlay.hidden = false;
  const seen = loadSeen();
  seen.add(t.key);
  markSeen(seen);
}

// ---------------------------------------------------------------------------
// Achievement toasts
// ---------------------------------------------------------------------------

const achievementQueue: string[] = [];
let achievementShowing = false;

function showAchievements(ids: string[]): void {
  achievementQueue.push(...ids);
  if (!achievementShowing) showNextAchievement();
}

function showNextAchievement(): void {
  const id = achievementQueue.shift();
  if (!id) {
    achievementShowing = false;
    return;
  }
  const a = getAchievement(id);
  if (!a) {
    showNextAchievement();
    return;
  }
  achievementShowing = true;
  achName.textContent = a.name;
  const parts: string[] = [];
  if (a.reward.freeze) parts.push(`\u2744 +${a.reward.freeze}`);
  if (a.reward.cutter) parts.push(`\u2702 +${a.reward.cutter}`);
  achReward.textContent = parts.length > 0 ? `Unlocked \u2022 ${parts.join('  ')}` : 'Achievement unlocked';
  achievementToast.hidden = false;
  achievementToast.classList.remove('leaving');
  audio.play('sfx_achievement');
  updateToolUi();
  setTimeout(() => {
    achievementToast.classList.add('leaving');
    setTimeout(() => {
      achievementToast.hidden = true;
      showNextAchievement();
    }, 420);
  }, 2600);
}

// ---------------------------------------------------------------------------
// Win handling
// ---------------------------------------------------------------------------

async function handleWin(moves: number): Promise<void> {
  if (!mode) return;
  stopLevelTimer();
  disarmCut();
  const timeMs = Math.round(performance.now() - levelStartAt);
  audio.play('sfx_level_win');

  let stars = projectedStars(moves);
  let ties: number;
  let timeBonus = 0;
  let unlocked: string[] = [];
  let subtitle = WIN_FLAVOR[Math.floor(Math.random() * WIN_FLAVOR.length)]!;
  let nextLabel = 'Next';

  if (mode.kind === 'campaign') {
    const level = mode.level;
    const levelId = level.id;
    const timeSec = Math.round(timeMs / 1000);
    const timeLeftSec = Math.max(0, timeLimitSec - timeSec);
    const server = await serverLevelComplete(levelId, moves, timeSec, maxChainReached, noToolsUsed);
    if (server) {
      stars = server.stars;
      ties = server.zipTiesEarned;
      timeBonus = server.timeBonus;
      unlocked = server.unlocked;
      profile = server.profile;
    } else {
      const timeLeftPct = timeLimitSec > 0 ? timeLeftSec / timeLimitSec : 0;
      timeBonus = timeBonusTies(timeLeftSec, timeLimitSec);
      const ctx: CompletionContext = {
        levelId,
        timeLeftPct,
        maxChain: maxChainReached,
        noTools: noToolsUsed,
        isBoss: level.isBoss,
      };
      const local = localLevelComplete(levelId, moves, currentPar, timeBonus, ctx);
      stars = local.stars;
      ties = local.ties;
      unlocked = local.unlocked;
    }
    winTitle.textContent = level.isBoss ? 'BOSS DEFEATED!' : 'Level Clear!';
    if (level.isBoss) {
      subtitle = 'The tower rumbles. A new floor unlocks above\u2026';
      audio.play('sfx_world_unlock');
    }
  } else {
    const server = await serverDailyScore(moves, timeMs);
    dailyDone = true;
    if (server) {
      ties = server.zipTiesEarned;
      unlocked = server.unlocked;
      profile = server.profile;
      subtitle = `Rank #${server.rank} of ${server.total} today \u2022 streak ${server.streak}`;
      if (server.streak > 1) audio.play('sfx_streak_flame');
    } else {
      profile.streak += 1;
      profile.lastDaily = dailyDate;
      ties = 3;
      profile.zipTies += ties;
      const local = checkAchievements(profile, null);
      if (local.length > 0) {
        profile.achievements = [...profile.achievements, ...local];
        const reward = rewardsFor(local);
        profile.tools.freeze += reward.freeze;
        profile.tools.cutter += reward.cutter;
      }
      unlocked = local;
      subtitle = `Cleared in ${moves} moves \u2022 streak ${profile.streak}`;
    }
    winTitle.textContent = 'Tangle Untangled!';
    nextLabel = 'Tower';
  }

  // Populate panel.
  winFlavor.textContent = subtitle;
  winMovesEl.textContent = String(moves);
  winParEl.textContent = String(currentPar);
  winTimeEl.textContent = formatClock(timeMs);
  winNextBtn.textContent = nextLabel;
  winTies.hidden = ties <= 0;
  winTiesN.textContent = String(ties);
  winBonus.hidden = timeBonus <= 0;
  if (ties > 0) setTimeout(() => audio.play('sfx_ziptie_earn'), 1400);
  if (unlocked.length > 0) setTimeout(() => showAchievements(unlocked), 1800);

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

toolFreezeBtn.addEventListener('click', () => {
  audio.play('sfx_ui_tap');
  useFreeze();
});

toolCutterBtn.addEventListener('click', () => {
  armCut();
});

tutorialOkBtn.addEventListener('click', () => {
  audio.play('sfx_ui_tap');
  showNextTutorial();
});

gameoverMapBtn.addEventListener('click', () => {
  audio.play('sfx_ui_tap');
  showMap();
});

gameoverRetryBtn.addEventListener('click', () => {
  audio.play('sfx_ui_tap');
  gameoverOverlay.hidden = true;
  if (mode?.kind === 'campaign') startCampaignLevel(mode.level);
  else startDaily();
});

dailyBtn.addEventListener('click', () => {
  if (dailyDone) return;
  audio.play('sfx_ui_tap');
  startDaily();
});

function toggleMute(): void {
  audio.setMuted(!audio.muted);
  const glyph = audio.muted ? '\u{1D13D}' : '\u266B';
  const label = audio.muted ? 'Unmute sound' : 'Mute sound';
  for (const b of [muteBtn, homeMuteBtn]) {
    b.textContent = glyph;
    b.setAttribute('aria-label', label);
  }
}

muteBtn.addEventListener('click', toggleMute);
homeMuteBtn.addEventListener('click', toggleMute);

mapHomeBtn.addEventListener('click', () => {
  audio.play('sfx_ui_tap');
  showHome();
});

homePlayBtn.addEventListener('click', () => {
  audio.play('sfx_ui_tap');
  showMap();
});

homeDailyBtn.addEventListener('click', () => {
  if (dailyDone) return;
  audio.play('sfx_ui_tap');
  startDaily();
});

homeAchBtn.addEventListener('click', () => {
  audio.play('sfx_ui_tap');
  openAchievements(screenHome);
});

mapAchBtn.addEventListener('click', () => {
  audio.play('sfx_ui_tap');
  openAchievements(screenMap);
});

achBackBtn.addEventListener('click', () => {
  audio.play('sfx_ui_tap');
  if (achReturnScreen === screenMap) showMap();
  else showHome();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  showScreen(screenLoading);
  await serverInit();
  await fetchRoster();
  showHome();
}

void boot();
