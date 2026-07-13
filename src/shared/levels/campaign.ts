import type { Difficulty, PuzzleDefinition, SceneType } from '../types';
import { generateFromSpec, type CustomSpec } from '../engine/LevelGenerator';
import { hashStringToSeed } from '../engine/rng';

/**
 * The Cable Tower — campaign data.
 *
 * 6 themed worlds x (10 levels + 1 boss) = 66 handcrafted-by-seed levels.
 * Every level is a deterministic (seed, spec) pair: all players get the
 * identical board, enabling fair comparison and shared discussion.
 *
 * Difficulty follows a sawtooth curve inside each world: teach -> ramp ->
 * breather -> ramp -> peak -> breather -> boss (see GAME_DESIGN.md §4.3).
 */

// ---------------------------------------------------------------------------
// World themes (drives the 3D scene + map visuals)
// ---------------------------------------------------------------------------

export type WorldTheme = {
  /** World number, 1-based. */
  id: number;
  name: string;
  tagline: string;
  scene: SceneType;
  difficulty: Difficulty;
  /** Stars required to unlock this world. */
  gateStars: number;
  /** Background gradient stops, top to bottom. */
  sky: [string, string, string];
  /** Scene fog color. */
  fog: string;
  /** Board panel base color. */
  panel: string;
  /** Enclosure chassis / wall / rim colors. */
  chassis: string;
  wall: string;
  rim: string;
  /** Emissive accent lip color. */
  accent: string;
  /** Key light + the two colored rim lights. */
  keyLight: string;
  rimLightA: string;
  rimLightB: string;
  /** UI accent for map section + HUD chips. */
  ui: string;
};

export const WORLDS: WorldTheme[] = [
  {
    id: 1,
    name: 'The Junk Drawer',
    tagline: 'Everyone has one. Yours fights back.',
    scene: 'desk',
    difficulty: 'easy',
    gateStars: 0,
    sky: ['#3d2c14', '#2a1d0e', '#171006'],
    fog: '#2a1d0e',
    panel: '#33261a',
    chassis: '#4a3722',
    wall: '#5c4426',
    rim: '#8a6a3a',
    accent: '#ffb02e',
    keyLight: '#ffd9a0',
    rimLightA: '#ff9d45',
    rimLightB: '#ffd27a',
    ui: '#ffb02e',
  },
  {
    id: 2,
    name: 'Entertainment Wall',
    tagline: 'The TV works. Nobody knows why.',
    scene: 'wall',
    difficulty: 'easy',
    gateStars: 12,
    sky: ['#4a2c3a', '#2c1a2e', '#140a18'],
    fog: '#2c1a2e',
    panel: '#2d2030',
    chassis: '#42304a',
    wall: '#543c5e',
    rim: '#7d5a8a',
    accent: '#ff8a5c',
    keyLight: '#ffc4a0',
    rimLightA: '#ff7a4d',
    rimLightB: '#5c8aff',
    ui: '#ff8a5c',
  },
  {
    id: 3,
    name: 'Open-Plan Office',
    tagline: 'Reply-all storms and cable storms.',
    scene: 'strip',
    difficulty: 'medium',
    gateStars: 26,
    sky: ['#2e3440', '#232935', '#141821'],
    fog: '#232935',
    panel: '#262c38',
    chassis: '#38404f',
    wall: '#46505f',
    rim: '#68748a',
    accent: '#7ec8ff',
    keyLight: '#e8f0ff',
    rimLightA: '#7ec8ff',
    rimLightB: '#c0cadb',
    ui: '#7ec8ff',
  },
  {
    id: 4,
    name: "The Streamer's Den",
    tagline: 'RGB everything. Readability nothing.',
    scene: 'gaming',
    difficulty: 'hard',
    gateStars: 42,
    sky: ['#33104a', '#1e0a33', '#0c0418'],
    fog: '#1e0a33',
    panel: '#221136',
    chassis: '#341a52',
    wall: '#45246b',
    rim: '#6b3aa0',
    accent: '#ff3ea5',
    keyLight: '#e0c0ff',
    rimLightA: '#ff3ea5',
    rimLightB: '#27d3ff',
    ui: '#ff3ea5',
  },
  {
    id: 5,
    name: 'Server Room',
    tagline: 'Do not touch. Touch everything.',
    scene: 'rack',
    difficulty: 'extreme',
    gateStars: 60,
    sky: ['#0e2233', '#091827', '#040c14'],
    fog: '#091827',
    panel: '#0e1c2a',
    chassis: '#16293c',
    wall: '#1e3750',
    rim: '#2f567a',
    accent: '#4dd8c0',
    keyLight: '#c0e4ff',
    rimLightA: '#4dd8c0',
    rimLightB: '#3aa0ff',
    ui: '#4dd8c0',
  },
  {
    id: 6,
    name: 'Nightmare Datacenter',
    tagline: 'Nobody has touched this switch since 2011.',
    scene: 'rack',
    difficulty: 'nightmare',
    gateStars: 80,
    sky: ['#26060a', '#160306', '#080102'],
    fog: '#160306',
    panel: '#1c0d10',
    chassis: '#2a1216',
    wall: '#38181e',
    rim: '#5c2630',
    accent: '#ff4d5c',
    keyLight: '#ffb0b0',
    rimLightA: '#ff4d5c',
    rimLightB: '#8a2be2',
    ui: '#ff4d5c',
  },
];

// ---------------------------------------------------------------------------
// Level specs — the sawtooth difficulty curve
// ---------------------------------------------------------------------------

/** Per-level world mechanics (each world introduces one, kept in later worlds). */
export type LevelMechanics = {
  /** W3+: one golden cable must be cleared last. */
  golden?: boolean;
  /** W4+: one live wire zaps you if grabbed while still crossing others. */
  liveWire?: boolean;
  /** W5+: blackout board with a pointer flashlight. */
  blackout?: boolean;
  /** W6: mid-level power surge swaps one cable's ends. */
  surge?: boolean;
};

export type CampaignLevel = {
  /** Global level id, e.g. "w2-7". */
  id: string;
  world: number;
  /** 1..11 within the world; 11 = boss. */
  index: number;
  name: string;
  isBoss: boolean;
  seed: number;
  spec: CustomSpec;
  /** Countdown limit in seconds; timeout = game over. */
  timeLimit: number;
  mechanics: LevelMechanics;
};

export const LEVELS_PER_WORLD = 11;

/** Base tuning per world: [grid, cables at start, cables at peak, crossings scale, max locks]. */
type WorldTuning = {
  gridW: number;
  gridH: number;
  cablesMin: number;
  cablesMax: number;
  crossMin: number;
  crossMax: number;
  locksMax: number;
};

const WORLD_TUNING: WorldTuning[] = [
  { gridW: 4, gridH: 4, cablesMin: 2, cablesMax: 5, crossMin: 1, crossMax: 4, locksMax: 0 },
  { gridW: 4, gridH: 5, cablesMin: 4, cablesMax: 7, crossMin: 3, crossMax: 7, locksMax: 1 },
  { gridW: 5, gridH: 5, cablesMin: 6, cablesMax: 9, crossMin: 5, crossMax: 9, locksMax: 2 },
  { gridW: 5, gridH: 6, cablesMin: 8, cablesMax: 11, crossMin: 7, crossMax: 12, locksMax: 3 },
  { gridW: 6, gridH: 6, cablesMin: 10, cablesMax: 13, crossMin: 9, crossMax: 15, locksMax: 4 },
  { gridW: 7, gridH: 7, cablesMin: 12, cablesMax: 16, crossMin: 12, crossMax: 19, locksMax: 5 },
];

/**
 * Sawtooth intensity per level index (1..10): teach, ramp, BREATHER, ramp,
 * ramp, ramp, peak, BREATHER, peak, peak. Boss (11) maxes everything.
 */
const INTENSITY: number[] = [0.0, 0.25, 0.12, 0.4, 0.55, 0.65, 0.8, 0.3, 0.9, 1.0];

const LEVEL_NAMES: string[][] = [
  // W1 The Junk Drawer
  ['First Untangle', 'Two of a Kind', 'Warm-Up Lap', 'Battery Pit', 'The Pencil Nest',
   'Charger Graveyard', 'Tape Roll Trouble', 'Little Victory', 'Deep Drawer', 'Bottom Shelf', 'THE DRAWER BOSS'],
  // W2 Entertainment Wall
  ['Bolted Down', 'Behind the TV', 'Soundbar Salad', 'Console Wars', 'HDMI Hydra',
   'Router Riddle', 'Speaker Spaghetti', 'Quiet Evening', 'The Wall Socket', 'Movie Night Mess', 'THE AV NIGHTMARE'],
  // W3 Open-Plan Office
  ['Monday 9 AM', 'Reply All', 'Coffee Break', 'The Standup', 'Desk Swap Day',
   'Printer Politics', 'Meeting Room B', 'Long Lunch', 'Quarterly Chaos', 'The Intern Did This', 'FLOOR SEVEN INCIDENT'],
  // W4 The Streamer's Den
  ['Going Live', 'RGB Overload', 'Chat Says Hi', 'Dual PC Setup', 'The Mic Arm',
   'Clip It', 'Raid Incoming', 'Chill Stream', 'Sub Goal Madness', '24-Hour Stream', 'THE FINAL BOSS FIGHT'],
  // W5 Server Room
  ['Badge Access', 'Patch Panel Panic', 'Cooling Down', 'Rack and Ruin', 'The Blinking One',
   'Cable Salad U12', 'Do Not Unplug', 'Scheduled Downtime', 'Legacy System', 'Root Cause', 'TOTAL OUTAGE'],
  // W6 Nightmare Datacenter
  ['Lights Out', 'Emergency Only', 'The Red Corridor', 'Unlabeled Everything', 'Ghost in the Rack',
   'Critical Path', 'No Documentation', 'Brief Respite', 'The Old Wing', 'Point of No Return', 'THE NIGHTMARE ITSELF'],
];

function levelSpec(world: number, index: number): CustomSpec {
  const t = WORLD_TUNING[world - 1]!;
  const isBoss = index === LEVELS_PER_WORLD;
  const k = isBoss ? 1 : INTENSITY[index - 1]!;
  const lerp = (a: number, b: number): number => Math.round(a + (b - a) * k);

  return {
    gridWidth: t.gridW,
    gridHeight: t.gridH,
    cableCount: lerp(t.cablesMin, t.cablesMax),
    minCrossings: lerp(t.crossMin, t.crossMax),
    // Locks appear from level 4 onward in worlds that have them.
    lockedEnds: index >= 4 ? Math.round(t.locksMax * k) : 0,
    // Boss levels get long, heavy "rats' nest" slack.
    ...(isBoss ? { slack: 1.45 } : {}),
  };
}

/** Base countdown seconds per world (before spec scaling). */
const WORLD_TIME_BASE = [55, 60, 65, 70, 75, 80];

/**
 * Countdown limit: base + 6s per cable + 4s per crossing; bosses +45s.
 * Tuned for ~2x slack in early worlds, tightening toward ~1.3x by W6.
 */
function levelTimeLimit(world: number, spec: CustomSpec, isBoss: boolean): number {
  const base = WORLD_TIME_BASE[world - 1] ?? 80;
  const t = base + spec.cableCount * 6 + spec.minCrossings * 4 + (isBoss ? 45 : 0);
  return Math.round(t / 5) * 5; // clean 5s steps
}

/**
 * Deterministic mechanics assignment. Each world introduces one mechanic
 * (from level 3 onward, so worlds open with familiar boards), and carries
 * earlier mechanics forward at reduced density.
 */
function levelMechanics(world: number, index: number, seed: number): LevelMechanics {
  const m: LevelMechanics = {};
  const isBoss = index === LEVELS_PER_WORLD;
  // Cheap deterministic hash roll in [0,1) per (mechanic, level).
  const roll = (salt: string): number => ((seed ^ hashStringToSeed(salt)) >>> 8) / 0x1000000;

  // W3+: golden cable — always on W3 L3+, ~30% carry-over later.
  if (world === 3 && index >= 3) m.golden = true;
  else if (world > 3 && !isBoss && roll('golden') < 0.3) m.golden = true;

  // W4+: live wire — always on W4 L3+, ~40% carry-over later.
  if (world === 4 && index >= 3) m.liveWire = true;
  else if (world > 4 && !isBoss && roll('livewire') < 0.4) m.liveWire = true;

  // W5+: blackout — always on W5 L3+, ~40% carry-over in W6.
  if (world === 5 && index >= 3) m.blackout = true;
  else if (world > 5 && !isBoss && roll('blackout') < 0.4) m.blackout = true;

  // W6: power surge on every level (bosses get 2 surges, handled client-side).
  if (world === 6) m.surge = true;

  return m;
}

/** Builds the full 66-level campaign table (cheap; pure data). */
export function buildCampaign(): CampaignLevel[] {
  const levels: CampaignLevel[] = [];
  for (let w = 1; w <= WORLDS.length; w++) {
    for (let i = 1; i <= LEVELS_PER_WORLD; i++) {
      const seed = hashStringToSeed(`cable-tower:v1:w${w}:l${i}`);
      const spec = levelSpec(w, i);
      const isBoss = i === LEVELS_PER_WORLD;
      levels.push({
        id: `w${w}-${i}`,
        world: w,
        index: i,
        name: LEVEL_NAMES[w - 1]![i - 1]!,
        isBoss,
        seed,
        spec,
        timeLimit: levelTimeLimit(w, spec, isBoss),
        mechanics: levelMechanics(w, i, seed),
      });
    }
  }
  return levels;
}

export const CAMPAIGN: CampaignLevel[] = buildCampaign();

export function getLevel(id: string): CampaignLevel | undefined {
  return CAMPAIGN.find((l) => l.id === id);
}

/** Deterministically generates the puzzle for a campaign level. */
export function generateCampaignLevel(level: CampaignLevel): PuzzleDefinition {
  const world = WORLDS[level.world - 1]!;
  const def = generateFromSpec(level.spec, level.seed, level.name, world.scene, world.difficulty);
  applyMechanics(def, level.mechanics, level.seed);
  return def;
}

/**
 * Marks mechanic cables on a generated puzzle, deterministically by seed.
 * Golden and live-wire picks avoid locked cables so both remain fully movable,
 * and avoid each other.
 */
export function applyMechanics(
  def: PuzzleDefinition,
  mechanics: LevelMechanics,
  seed: number
): void {
  const movable = def.cables.filter((c) => !c.lockA && !c.lockB);
  if (mechanics.golden && movable.length >= 2) {
    const pick = movable[seed % movable.length]!;
    def.goldenCableId = pick.id;
  }
  if (mechanics.liveWire) {
    const candidates = movable.filter((c) => c.id !== def.goldenCableId);
    if (candidates.length >= 1) {
      const pick = candidates[(seed >>> 4) % candidates.length]!;
      def.liveWireCableId = pick.id;
    }
  }
  if (mechanics.blackout) def.blackout = true;
  if (mechanics.surge) def.surge = true;
}

// ---------------------------------------------------------------------------
// Stars & economy rules
// ---------------------------------------------------------------------------

/** 3★ at par, 2★ within par + ceil(par/2), 1★ for any clear. */
export function starsForClear(moves: number, par: number): 1 | 2 | 3 {
  if (moves <= par) return 3;
  if (moves <= par + Math.ceil(par / 2)) return 2;
  return 1;
}

/** Zip Ties earned for a clear (first clear pays more; 3★ pays a bonus). */
export function zipTiesForClear(stars: number, firstClear: boolean): number {
  let earned = firstClear ? 2 : 0;
  if (stars === 3) earned += 1;
  return earned;
}

/** Time bonus: finish with more than half the clock left = +1 Zip Tie. */
export function timeBonusTies(timeLeftSec: number, timeLimit: number): number {
  return timeLimit > 0 && timeLeftSec / timeLimit > 0.5 ? 1 : 0;
}

export const MAX_STARS = CAMPAIGN.length * 3;

/** Total stars needed to unlock each world (index 0 = world 1). */
export function worldGate(world: number): number {
  return WORLDS[world - 1]?.gateStars ?? 0;
}
