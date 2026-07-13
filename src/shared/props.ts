import type { DeviceType, Difficulty, PlugShape, SceneType } from './types';

/**
 * Static prop definitions: the visual + semantic properties of each device
 * type, the scene backdrops, and the difficulty tuning tables. Kept in shared
 * so the generator (server) and renderer (client) agree on colors and labels.
 */

export type DeviceSpec = {
  type: DeviceType;
  label: string;
  /** Cable jacket color (hex). */
  color: string;
  /** Short glyph shown on the connected device badge. */
  glyph: string;
  /** Connector silhouette used by the renderer. */
  shape: PlugShape;
};

export const DEVICE_SPECS: Record<DeviceType, DeviceSpec> = {
  usb_a: { type: 'usb_a', label: 'Keyboard', color: '#ff8a3d', glyph: 'USB', shape: 'rect' },
  usb_c: { type: 'usb_c', label: 'Mouse', color: '#b06bff', glyph: 'USB-C', shape: 'round' },
  hdmi: { type: 'hdmi', label: 'Monitor', color: '#3aa0ff', glyph: 'HDMI', shape: 'wide' },
  dp: { type: 'dp', label: 'Display', color: '#12d8fa', glyph: 'DP', shape: 'wide' },
  power: { type: 'power', label: 'Power', color: '#ffd21f', glyph: 'PWR', shape: 'barrel' },
  ethernet: { type: 'ethernet', label: 'Network', color: '#33e07a', glyph: 'LAN', shape: 'rect' },
  audio: { type: 'audio', label: 'Speakers', color: '#ff4d6d', glyph: 'AUX', shape: 'barrel' },
  lightning: { type: 'lightning', label: 'Phone', color: '#f2f4f8', glyph: '⚡', shape: 'round' },
  usb_b: { type: 'usb_b', label: 'Printer', color: '#ff5cc6', glyph: 'USB-B', shape: 'rect' },
  coax: { type: 'coax', label: 'TV', color: '#9aa3b2', glyph: 'COAX', shape: 'barrel' },
};

/** All device types, as an ordered pool for the generator to sample from. */
export const DEVICE_POOL: DeviceType[] = Object.keys(DEVICE_SPECS) as DeviceType[];

export type SceneSpec = {
  type: SceneType;
  label: string;
  /** Background surface color. */
  background: string;
  /** Accent used for grid guides / port rings. */
  accent: string;
};

export const SCENE_SPECS: Record<SceneType, SceneSpec> = {
  desk: { type: 'desk', label: 'Home Desk', background: '#14131a', accent: '#2f2b3a' },
  rack: { type: 'rack', label: 'Server Rack', background: '#0c0e13', accent: '#1c2432' },
  strip: { type: 'strip', label: 'Power Strip', background: '#15161d', accent: '#333747' },
  wall: { type: 'wall', label: 'Wall Plate', background: '#141219', accent: '#2c2937' },
  gaming: { type: 'gaming', label: 'Gaming Setup', background: '#0a0912', accent: '#241a38' },
};

export type DifficultySpec = {
  difficulty: Difficulty;
  gridWidth: number;
  gridHeight: number;
  cableCount: number;
  /** Number of ports that stay empty (maneuvering room). */
  emptyPorts: number;
  /** Minimum number of crossings the generated board must contain. */
  minCrossings: number;
  /** How many cable ends are bolted down (immovable) — pure difficulty. */
  lockedEnds: number;
  /** Scenes this difficulty can use. */
  scenes: SceneType[];
};

export const DIFFICULTY_SPECS: Record<Difficulty, DifficultySpec> = {
  easy: {
    difficulty: 'easy',
    gridWidth: 4,
    gridHeight: 4,
    cableCount: 3,
    emptyPorts: 6,
    minCrossings: 2,
    lockedEnds: 0,
    scenes: ['wall', 'strip'],
  },
  medium: {
    difficulty: 'medium',
    gridWidth: 5,
    gridHeight: 5,
    cableCount: 7,
    emptyPorts: 8,
    minCrossings: 6,
    lockedEnds: 1,
    scenes: ['desk'],
  },
  hard: {
    difficulty: 'hard',
    gridWidth: 5,
    gridHeight: 6,
    cableCount: 9,
    emptyPorts: 7,
    minCrossings: 9,
    lockedEnds: 2,
    scenes: ['desk', 'rack'],
  },
  extreme: {
    difficulty: 'extreme',
    gridWidth: 6,
    gridHeight: 6,
    cableCount: 12,
    emptyPorts: 6,
    minCrossings: 13,
    lockedEnds: 3,
    scenes: ['rack'],
  },
  nightmare: {
    difficulty: 'nightmare',
    gridWidth: 7,
    gridHeight: 7,
    cableCount: 16,
    emptyPorts: 8,
    minCrossings: 18,
    lockedEnds: 5,
    scenes: ['gaming'],
  },
};
