/**
 * Core domain types for Loose Cables.
 *
 * These types are shared between the client (gameplay rendering) and the
 * server (puzzle validation). The PuzzleEngine that operates on them is pure:
 * no Phaser, no Devvit, no async, no side effects.
 */

export type Vec2 = {
  x: number;
  y: number;
};

/**
 * Device categories. Each cable represents a device being plugged in.
 * The device type drives the cable color, plug silhouette, and label.
 */
export type DeviceType =
  | 'usb_a'
  | 'usb_c'
  | 'hdmi'
  | 'dp'
  | 'power'
  | 'ethernet'
  | 'audio'
  | 'lightning'
  | 'usb_b'
  | 'coax';

/**
 * A fixed grid slot. Ports live at integer (col, row) coordinates and are
 * projected to pixel space by the renderer. The engine works purely in grid
 * space using node center positions.
 */
export type Port = {
  id: number;
  col: number;
  row: number;
};

/**
 * A cable connects two ports. `zIndex` encodes stacking order: a cable with a
 * higher zIndex sits on top of (and therefore traps) a lower one wherever they
 * cross.
 */
export type Cable = {
  id: string;
  deviceType: DeviceType;
  color: string;
  portA: number;
  portB: number;
  zIndex: number;
  /** End A is bolted down: it cannot be grabbed or relocated (adds difficulty). */
  lockA?: boolean;
  /** End B is bolted down: it cannot be grabbed or relocated (adds difficulty). */
  lockB?: boolean;
};

/** Connector silhouette, drives how plugs and sockets are modelled. */
export type PlugShape = 'rect' | 'round' | 'wide' | 'barrel';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'extreme' | 'nightmare';

export type SceneType = 'desk' | 'rack' | 'strip' | 'wall' | 'gaming';

/**
 * The immutable definition of a puzzle. This is what gets serialized to
 * Redis / postData and shared between users. It contains everything needed to
 * reconstruct the starting board.
 */
export type PuzzleDefinition = {
  version: number;
  name: string;
  difficulty: Difficulty;
  scene: SceneType;
  gridWidth: number;
  gridHeight: number;
  ports: Port[];
  cables: Cable[];
  /** Port ids that start empty (available as drop targets). */
  emptyPortIds: number[];
  /** Minimum moves required to solve, computed at generation time. */
  optimalMoves: number;
  /** Renderer cable slack multiplier (1 = default; boss levels use more). */
  slack?: number;
};

/**
 * Mutable runtime state for an in-progress solve. Built from a
 * PuzzleDefinition and mutated as the player makes moves.
 */
export type PuzzleState = {
  definition: PuzzleDefinition;
  /** Current occupant of each port id, or null if empty. Maps portId -> plug. */
  plugs: Map<number, PlugRef>;
  /** Cable ids that have auto-resolved (left the board). */
  resolved: Set<string>;
  moveCount: number;
  undoCount: number;
};

/**
 * Identifies one end of a cable currently seated in a port.
 */
export type PlugRef = {
  cableId: string;
  end: 'A' | 'B';
};

/** A single move: relocating one plug from one port to another. */
export type Move = {
  cableId: string;
  end: 'A' | 'B';
  fromPortId: number;
  toPortId: number;
};
