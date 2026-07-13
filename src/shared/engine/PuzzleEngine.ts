import type {
  Cable,
  Move,
  PlugRef,
  Port,
  PuzzleDefinition,
  PuzzleState,
  Vec2,
} from '../types';
import { segmentsIntersect } from './geometry';

/**
 * PuzzleEngine — the pure rules of Loose Cables.
 *
 * All functions are pure: they take state and return new data (or a mutated
 * clone) without touching Phaser, Devvit, timers, or randomness. This keeps the
 * rules deterministic and unit-testable, and lets the server validate solutions
 * with the exact same logic as the client.
 *
 * Mechanic (faithful to the "untangle" reference): ports sit on a grid; cables
 * are straight segments between two port centers; the player drags a cable end
 * (plug) to any EMPTY port. A cable auto-resolves (dissolves, freeing its ports)
 * the moment it crosses no other active cable. The board is won when every cable
 * has resolved. `zIndex` is retained for over/under VISUAL rendering only — it
 * does not restrict movement.
 */

// ---------------------------------------------------------------------------
// State construction
// ---------------------------------------------------------------------------

export function createState(definition: PuzzleDefinition): PuzzleState {
  const plugs = new Map<number, PlugRef>();
  for (const cable of definition.cables) {
    plugs.set(cable.portA, { cableId: cable.id, end: 'A' });
    plugs.set(cable.portB, { cableId: cable.id, end: 'B' });
  }
  return {
    definition,
    plugs,
    resolved: new Set<string>(),
    moveCount: 0,
    undoCount: 0,
  };
}

export function cloneState(state: PuzzleState): PuzzleState {
  return {
    definition: state.definition,
    plugs: new Map(state.plugs),
    resolved: new Set(state.resolved),
    moveCount: state.moveCount,
    undoCount: state.undoCount,
  };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

function buildPortIndex(ports: Port[]): Map<number, Port> {
  const index = new Map<number, Port>();
  for (const port of ports) index.set(port.id, port);
  return index;
}

export function portPosition(port: Port): Vec2 {
  return { x: port.col, y: port.row };
}

export function portIdForEnd(state: PuzzleState, cableId: string, end: 'A' | 'B'): number {
  for (const [portId, plug] of state.plugs) {
    if (plug.cableId === cableId && plug.end === end) return portId;
  }
  throw new Error(`Cable ${cableId} end ${end} is not plugged into any port`);
}

function cableEndpoints(
  state: PuzzleState,
  cable: Cable,
  ports: Map<number, Port>
): { a: Vec2; b: Vec2 } {
  const portA = ports.get(portIdForEnd(state, cable.id, 'A'));
  const portB = ports.get(portIdForEnd(state, cable.id, 'B'));
  if (!portA || !portB) throw new Error(`Cable ${cable.id} references a missing port`);
  return { a: portPosition(portA), b: portPosition(portB) };
}

export function getEmptyPortIds(state: PuzzleState): number[] {
  const empty: number[] = [];
  for (const port of state.definition.ports) {
    if (!state.plugs.has(port.id)) empty.push(port.id);
  }
  return empty;
}

export function activeCables(state: PuzzleState): Cable[] {
  return state.definition.cables.filter((c) => !state.resolved.has(c.id));
}

// ---------------------------------------------------------------------------
// Crossings
// ---------------------------------------------------------------------------

export function cablesCross(
  state: PuzzleState,
  a: Cable,
  b: Cable,
  ports: Map<number, Port>
): boolean {
  const ea = cableEndpoints(state, a, ports);
  const eb = cableEndpoints(state, b, ports);
  return segmentsIntersect(ea.a, ea.b, eb.a, eb.b);
}

/** Does this cable cross any other active cable right now? */
export function hasAnyCrossing(state: PuzzleState, cable: Cable): boolean {
  if (state.resolved.has(cable.id)) return false;
  const ports = buildPortIndex(state.definition.ports);
  for (const other of activeCables(state)) {
    if (other.id === cable.id) continue;
    if (cablesCross(state, cable, other, ports)) return true;
  }
  return false;
}

/** Total number of crossing pairs among active cables (for difficulty tuning). */
export function countActiveCrossings(state: PuzzleState): number {
  const ports = buildPortIndex(state.definition.ports);
  const cables = activeCables(state);
  let count = 0;
  for (let i = 0; i < cables.length; i++) {
    for (let j = i + 1; j < cables.length; j++) {
      if (cablesCross(state, cables[i]!, cables[j]!, ports)) count++;
    }
  }
  return count;
}

/**
 * Whether a cable is locked: a higher-zIndex cable crosses over it, so it is
 * physically trapped underneath and cannot be moved until the cables on top are
 * cleared. Drives both the "trapped" visual and the movement rule.
 */
export function isCableLocked(state: PuzzleState, cable: Cable): boolean {
  if (state.resolved.has(cable.id)) return false;
  const ports = buildPortIndex(state.definition.ports);
  for (const other of activeCables(state)) {
    if (other.id === cable.id) continue;
    if (other.zIndex <= cable.zIndex) continue;
    if (cablesCross(state, cable, other, ports)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

export function canMove(state: PuzzleState, cableId: string, toPortId: number): boolean {
  if (state.resolved.has(cableId)) return false;
  if (state.plugs.has(toPortId)) return false; // target must be empty
  return state.definition.ports.some((p) => p.id === toPortId);
}

/**
 * Applies a move in place and returns the Move descriptor (for the undo stack).
 * Throws on an illegal move — guard with canMove() first.
 */
export function applyMove(
  state: PuzzleState,
  cableId: string,
  end: 'A' | 'B',
  toPortId: number
): Move {
  if (!canMove(state, cableId, toPortId)) {
    throw new Error(`Illegal move: cable ${cableId}/${end} -> port ${toPortId}`);
  }
  const fromPortId = portIdForEnd(state, cableId, end);
  state.plugs.delete(fromPortId);
  state.plugs.set(toPortId, { cableId, end });
  state.moveCount += 1;
  return { cableId, end, fromPortId, toPortId };
}

// ---------------------------------------------------------------------------
// Auto-resolve
// ---------------------------------------------------------------------------

/**
 * Resolves every cable with zero crossings, cascading until stable. Returns the
 * ordered ids resolved this pass so the renderer can sequence the animations.
 */
export function resolveCascade(state: PuzzleState): string[] {
  const resolvedThisPass: string[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const cable of activeCables(state)) {
      if (!hasAnyCrossing(state, cable)) {
        state.resolved.add(cable.id);
        state.plugs.delete(portIdForEnd(state, cable.id, 'A'));
        state.plugs.delete(portIdForEnd(state, cable.id, 'B'));
        resolvedThisPass.push(cable.id);
        progress = true;
      }
    }
  }
  return resolvedThisPass;
}

export function isWon(state: PuzzleState): boolean {
  return state.resolved.size === state.definition.cables.length;
}

// ---------------------------------------------------------------------------
// Solver (bounded BFS) — used for UGC validation and optimal-move calculation
// ---------------------------------------------------------------------------

/** Compact, order-independent key for a state's active plug arrangement. */
function stateKey(state: PuzzleState): string {
  const parts: string[] = [];
  for (const [portId, plug] of state.plugs) {
    parts.push(`${plug.cableId}${plug.end}:${portId}`);
  }
  parts.sort();
  return parts.join('|');
}

export type SolveResult = {
  solved: boolean;
  /** Shortest number of moves found (only meaningful when solved). */
  moves: number;
  /** True if the search hit its node budget before proving solvability. */
  budgetExhausted: boolean;
};

/**
 * Breadth-first search for the shortest solution. A move relocates any active
 * plug to any empty port; after each move the auto-resolve cascade runs. The
 * board is solved when all cables have resolved.
 *
 * Bounded by `maxNodes` so pathological inputs can't hang the server. For our
 * puzzle sizes (and especially scramble-generated boards with short solutions)
 * the true optimum is found well within budget.
 */
export function solve(
  definition: PuzzleDefinition,
  maxNodes = 200_000,
  respectLocking = false
): SolveResult {
  const start = createState(definition);
  resolveCascade(start); // resolve anything already clear

  if (isWon(start)) return { solved: true, moves: 0, budgetExhausted: false };

  const visited = new Set<string>([stateKey(start)]);
  let frontier: PuzzleState[] = [start];
  let depth = 0;
  let nodes = 0;

  while (frontier.length > 0) {
    depth++;
    const next: PuzzleState[] = [];

    for (const state of frontier) {
      const emptyPorts = getEmptyPortIds(state);
      for (const cable of activeCables(state)) {
        // Under the locking rule, a cable pinned beneath a higher cable can't
        // be moved until the ones above it are cleared.
        if (respectLocking && isCableLocked(state, cable)) continue;
        for (const end of ['A', 'B'] as const) {
          for (const toPort of emptyPorts) {
            if (++nodes > maxNodes) {
              return { solved: false, moves: -1, budgetExhausted: true };
            }
            const child = cloneState(state);
            applyMove(child, cable.id, end, toPort);
            resolveCascade(child);

            if (isWon(child)) {
              return { solved: true, moves: depth, budgetExhausted: false };
            }
            const key = stateKey(child);
            if (!visited.has(key)) {
              visited.add(key);
              next.push(child);
            }
          }
        }
      }
    }
    frontier = next;
  }

  return { solved: false, moves: -1, budgetExhausted: false };
}

/** Convenience: is this puzzle solvable within the search budget? */
export function isSolvable(definition: PuzzleDefinition, maxNodes = 200_000): boolean {
  return solve(definition, maxNodes).solved;
}
