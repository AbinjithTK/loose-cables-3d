import type {
  Cable,
  Difficulty,
  Port,
  PuzzleDefinition,
  PuzzleState,
  SceneType,
} from '../types';
import { DEVICE_POOL, DEVICE_SPECS, DIFFICULTY_SPECS } from '../props';
import {
  activeCables,
  countActiveCrossings,
  createState,
  getEmptyPortIds,
  portIdForEnd,
  solve,
} from './PuzzleEngine';
import { SeededRNG, hashStringToSeed } from './rng';

/**
 * LevelGenerator — deterministic procedural puzzle creation.
 *
 * Strategy: scramble-from-solution.
 *   1. Build a guaranteed clean (zero-crossing) arrangement using horizontal
 *      "domino" cables — axis-aligned unit segments that never cross.
 *   2. Scramble it by making random legal moves (relocating a plug to an empty
 *      port) until the board has at least `minCrossings` tangles.
 * Because every scramble move is reversible (there is no movement lock), the
 * resulting board is always solvable — the player simply undoes the scramble.
 */

const PUZZLE_VERSION = 1;

function buildGridPorts(width: number, height: number): Port[] {
  const ports: Port[] = [];
  let id = 0;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      ports.push({ id, col, row });
      id++;
    }
  }
  return ports;
}

function portIdAt(width: number, col: number, row: number): number {
  return row * width + col;
}

/**
 * Places `cableCount` non-crossing horizontal domino cables. Each occupies two
 * horizontally-adjacent cells; placements never overlap, so zero crossings are
 * guaranteed. Returns null if the grid can't fit that many dominoes.
 */
function buildCleanArrangement(
  width: number,
  height: number,
  cableCount: number,
  rng: SeededRNG
): Cable[] | null {
  // Enumerate all possible horizontal domino slots, then choose a subset.
  const slots: Array<{ a: number; b: number }> = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col + 1 < width; col += 2) {
      slots.push({
        a: portIdAt(width, col, row),
        b: portIdAt(width, col + 1, row),
      });
    }
  }
  if (slots.length < cableCount) return null;

  const chosen = rng.shuffle(slots).slice(0, cableCount);
  return chosen.map((slot, i) => {
    const deviceType = rng.pick(DEVICE_POOL);
    return {
      id: `c${i}`,
      deviceType,
      color: DEVICE_SPECS[deviceType].color,
      portA: slot.a,
      portB: slot.b,
      zIndex: i,
    };
  });
}

/** Relocates a plug in place without gameplay bookkeeping (generation only). */
function relocate(state: PuzzleState, cableId: string, end: 'A' | 'B', toPortId: number): void {
  const fromPortId = portIdForEnd(state, cableId, end);
  state.plugs.delete(fromPortId);
  state.plugs.set(toPortId, { cableId, end });
}

/**
 * Scrambles a clean arrangement into a tangled (but solvable) board.
 *
 * Each step greedily searches for the plug relocation that most increases the
 * crossing count, guaranteeing we build up to `minCrossings` even on sparse
 * boards. If no move increases crossings (rare), it makes a random move to
 * escape the local arrangement. Because every move relocates a plug to an empty
 * port with no locking, the scramble is fully reversible — so the result is
 * always solvable in at most `moveCount` moves.
 */
function scramble(
  definition: PuzzleDefinition,
  minCrossings: number,
  rng: SeededRNG,
  maxMoves: number
): { cables: Cable[]; emptyPortIds: number[]; moveCount: number; movedEnds: Set<string> } {
  const state = createState(definition);
  let applied = 0;
  const movedEnds = new Set<string>();

  for (let move = 0; move < maxMoves; move++) {
    const crossings = countActiveCrossings(state);
    if (crossings >= minCrossings) break;

    const empties = getEmptyPortIds(state);
    if (empties.length === 0) break;

    // Find the relocation that increases crossings the most.
    let best: { cableId: string; end: 'A' | 'B'; from: number; to: number } | null = null;
    let bestDelta = 0;

    for (const cable of activeCables(state)) {
      for (const end of ['A', 'B'] as const) {
        const from = portIdForEnd(state, cable.id, end);
        for (const target of empties) {
          relocate(state, cable.id, end, target);
          const delta = countActiveCrossings(state) - crossings;
          relocate(state, cable.id, end, from); // revert
          if (delta > bestDelta) {
            bestDelta = delta;
            best = { cableId: cable.id, end, from, to: target };
          }
        }
      }
    }

    if (best) {
      relocate(state, best.cableId, best.end, best.to);
      movedEnds.add(`${best.cableId}:${best.end}`);
    } else {
      // No improving move: make a random move to reshuffle and try again.
      const cable = rng.pick(activeCables(state));
      const end = rng.next() < 0.5 ? 'A' : 'B';
      relocate(state, cable.id, end, rng.pick(empties));
      movedEnds.add(`${cable.id}:${end}`);
    }
    applied++;
  }

  const cables: Cable[] = definition.cables.map((c) => ({
    ...c,
    portA: portIdForEnd(state, c.id, 'A'),
    portB: portIdForEnd(state, c.id, 'B'),
  }));

  return { cables, emptyPortIds: getEmptyPortIds(state), moveCount: applied, movedEnds };
}

export type GenerateOptions = {
  difficulty: Difficulty;
  seed: number;
  name?: string;
  scene?: SceneType;
};

/**
 * Fully custom generation knobs — used by the campaign level table so every
 * level is an individually tuned, deterministic seed instead of a preset tier.
 */
export type CustomSpec = {
  gridWidth: number;
  gridHeight: number;
  cableCount: number;
  minCrossings: number;
  lockedEnds: number;
  /** Cable slack multiplier for the renderer (1 = default; boss "rats' nest" cables use more). */
  slack?: number;
};

export function generateFromSpec(
  spec: CustomSpec,
  seed: number,
  name: string,
  scene: SceneType,
  difficulty: Difficulty = 'medium'
): PuzzleDefinition {
  const rng = new SeededRNG(seed);
  const { gridWidth, gridHeight, cableCount, minCrossings } = spec;
  const ports = buildGridPorts(gridWidth, gridHeight);

  const cleanCables = buildCleanArrangement(gridWidth, gridHeight, cableCount, rng);
  if (!cleanCables) {
    throw new Error(`Grid ${gridWidth}x${gridHeight} cannot fit ${cableCount} cables`);
  }

  const cleanDefinition: PuzzleDefinition = {
    version: PUZZLE_VERSION,
    name,
    difficulty,
    scene,
    gridWidth,
    gridHeight,
    ports,
    cables: cleanCables,
    emptyPortIds: [],
    optimalMoves: 0,
    slack: spec.slack,
  };

  const scrambled = scramble(cleanDefinition, minCrossings, rng, minCrossings * 4 + 20);

  const definition: PuzzleDefinition = {
    ...cleanDefinition,
    cables: scrambled.cables,
    emptyPortIds: scrambled.emptyPortIds,
  };

  if (spec.lockedEnds > 0) {
    applyLocks(definition, scrambled.movedEnds, spec.lockedEnds, rng);
  }

  definition.optimalMoves = Math.max(1, scrambled.moveCount);
  return definition;
}

/** Locks a subset of ends the scramble never moved (keeps solvability). */
function applyLocks(
  definition: PuzzleDefinition,
  movedEnds: Set<string>,
  lockedEnds: number,
  rng: SeededRNG
): void {
  const lockable: Array<{ cableId: string; end: 'A' | 'B' }> = [];
  for (const c of definition.cables) {
    if (!movedEnds.has(`${c.id}:A`)) lockable.push({ cableId: c.id, end: 'A' });
    if (!movedEnds.has(`${c.id}:B`)) lockable.push({ cableId: c.id, end: 'B' });
  }
  const byId = new Map(definition.cables.map((c) => [c.id, c]));
  const lockedCables = new Set<string>();
  let placed = 0;
  for (const { cableId, end } of rng.shuffle(lockable)) {
    if (placed >= lockedEnds) break;
    if (lockedCables.has(cableId)) continue;
    const c = byId.get(cableId)!;
    if (end === 'A') c.lockA = true;
    else c.lockB = true;
    lockedCables.add(cableId);
    placed++;
  }
}

export function generatePuzzle(options: GenerateOptions): PuzzleDefinition {
  const spec = DIFFICULTY_SPECS[options.difficulty];
  const rng = new SeededRNG(options.seed);

  const { gridWidth, gridHeight, cableCount, minCrossings } = spec;
  const ports = buildGridPorts(gridWidth, gridHeight);
  const scene = options.scene ?? rng.pick(spec.scenes);

  const cleanCables = buildCleanArrangement(gridWidth, gridHeight, cableCount, rng);
  if (!cleanCables) {
    throw new Error(
      `Grid ${gridWidth}x${gridHeight} cannot fit ${cableCount} cables for ${options.difficulty}`
    );
  }

  const cleanDefinition: PuzzleDefinition = {
    version: PUZZLE_VERSION,
    name: options.name ?? `${spec.difficulty} puzzle`,
    difficulty: options.difficulty,
    scene,
    gridWidth,
    gridHeight,
    ports,
    cables: cleanCables,
    emptyPortIds: [],
    optimalMoves: 0,
  };

  // Scramble budget scales with tangle target.
  const scrambled = scramble(cleanDefinition, minCrossings, rng, minCrossings * 4 + 20);

  const definition: PuzzleDefinition = {
    ...cleanDefinition,
    cables: scrambled.cables,
    emptyPortIds: scrambled.emptyPortIds,
  };

  // Lock a subset of ends that the scramble never moved. Because a valid
  // solution (reversing the scramble) only ever moves the ends that WERE
  // scrambled, locking un-moved ends keeps the puzzle solvable while removing
  // maneuvering handles — a clean difficulty lever.
  if (spec.lockedEnds > 0) {
    const lockable: Array<{ cableId: string; end: 'A' | 'B' }> = [];
    for (const c of definition.cables) {
      if (!scrambled.movedEnds.has(`${c.id}:A`)) lockable.push({ cableId: c.id, end: 'A' });
      if (!scrambled.movedEnds.has(`${c.id}:B`)) lockable.push({ cableId: c.id, end: 'B' });
    }
    const byId = new Map(definition.cables.map((c) => [c.id, c]));
    const lockedCables = new Set<string>();
    let placed = 0;
    // Never lock both ends of the same cable (that cable would be unmovable and
    // pointless); at most one lock per cable.
    for (const { cableId, end } of rng.shuffle(lockable)) {
      if (placed >= spec.lockedEnds) break;
      if (lockedCables.has(cableId)) continue;
      const c = byId.get(cableId)!;
      if (end === 'A') c.lockA = true;
      else c.lockB = true;
      lockedCables.add(cableId);
      placed++;
    }
  }

  // Solvability is guaranteed by construction: the board was built by scrambling
  // a clean arrangement with fully-reversible moves, so reversing the scramble
  // always solves it. The scramble move count is therefore a valid upper bound
  // on the optimum and serves as a fair, stable efficiency "par" — no expensive
  // search required at generation time.
  definition.optimalMoves = Math.max(1, scrambled.moveCount);

  return definition;
}

/**
 * "Make It Worse" — adds one random cable and keeps the puzzle solvable.
 *
 * A newly added cable occupies two previously-empty ports. To guarantee the
 * augmented board is still beatable, we verify with the bounded solver and
 * retry different port pairs; if none keep it solvable we return null.
 */
export function makeItWorse(definition: PuzzleDefinition, seed: number): PuzzleDefinition | null {
  const rng = new SeededRNG(seed);
  const emptyPortIds = [...definition.emptyPortIds];
  if (emptyPortIds.length < 2) return null;

  const maxZ = definition.cables.reduce((m, c) => Math.max(m, c.zIndex), -1);

  for (let attempt = 0; attempt < 12; attempt++) {
    const shuffled = rng.shuffle(emptyPortIds);
    const portA = shuffled[0]!;
    const portB = shuffled[1]!;
    const deviceType = rng.pick(DEVICE_POOL);

    const newCable: Cable = {
      id: `c${definition.cables.length}`,
      deviceType,
      color: DEVICE_SPECS[deviceType].color,
      portA,
      portB,
      zIndex: maxZ + 1,
    };

    const candidate: PuzzleDefinition = {
      ...definition,
      cables: [...definition.cables, newCable],
      emptyPortIds: emptyPortIds.filter((id) => id !== portA && id !== portB),
    };

    // Accept if solvable, or if the search ran out of budget on a large board
    // (we can't prove unsolvability, and the base puzzle was solvable). Only a
    // definitive "unsolvable" verdict causes a retry.
    const result = solve(candidate, 60_000);
    if (result.solved || result.budgetExhausted) {
      candidate.optimalMoves = definition.optimalMoves + 1;
      return candidate;
    }
  }

  return null;
}

/** Validates a handcrafted / remixed puzzle before publishing. */
export function validatePuzzle(definition: PuzzleDefinition): { valid: boolean; reason?: string } {
  if (definition.cables.length < 2) {
    return { valid: false, reason: 'Needs at least 2 cables' };
  }
  const state = createState(definition);
  if (countActiveCrossings(state) === 0) {
    return { valid: false, reason: 'Puzzle is already solved (no tangles)' };
  }
  // Reject only on a definitive unsolvable verdict. If the bounded search runs
  // out of budget we defer to the "solve to submit" guarantee (the creator
  // proved it solvable by beating it themselves before publishing).
  const result = solve(definition, 80_000);
  if (!result.solved && !result.budgetExhausted) {
    return { valid: false, reason: 'Puzzle is not solvable' };
  }
  return { valid: true };
}

export function dailySeed(dateIso: string): number {
  return hashStringToSeed(`loose-cables:${dateIso}`);
}

const DAILY_ROTATION: Difficulty[] = [
  'easy', // Sunday
  'easy', // Monday
  'medium', // Tuesday
  'hard', // Wednesday
  'extreme', // Thursday
  'nightmare', // Friday
  'medium', // Saturday
];

const DAILY_TITLES = [
  'Sunday Chill Desk',
  'Monday Morning Desk',
  'Meeting Room Tangle',
  'Home Office Hump Day',
  'The IT Closet',
  'Server Room Friday',
  'Weekend Gaming Setup',
];

export function generateDailyPuzzle(date: Date): PuzzleDefinition {
  const iso = date.toISOString().slice(0, 10);
  const dayOfWeek = date.getUTCDay();
  const difficulty = DAILY_ROTATION[dayOfWeek]!;
  const title = DAILY_TITLES[dayOfWeek]!;
  const epochDays = Math.floor(date.getTime() / 86400000);

  return generatePuzzle({
    difficulty,
    seed: dailySeed(iso),
    name: `${title} #${epochDays}`,
  });
}
