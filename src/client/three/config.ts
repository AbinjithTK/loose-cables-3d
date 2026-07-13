/** Shared tuning for the 3D cable board. */

export const GRID = 5;
export const SPACING = 2.2;
/** Height at which cable ends attach to pegs — low so cables lie flat on the board (top-down view). */
export const PEG_TOP_Y = 0.3;
export const CABLE_RADIUS = 0.26;
/** Physics segments per cable (bodies = SEGMENTS + 1). */
export const SEGMENTS = 12;

/** Vibrant, well-separated cable colors. */
export const CABLE_COLORS = [
  0xff8a3d, 0x3aa0ff, 0x33e07a, 0xff4d6d, 0xb06bff, 0x12d8fa, 0xffd21f, 0xff5cc6,
];

/** Collision groups (bitmask). Floor is bit 0; each cable gets its own bit. */
export const FLOOR_GROUP = 1;
export const cableGroupBit = (index: number): number => 1 << (index + 1);

/** Grid peg position in world space (board centered on origin, XZ plane). */
export function pegWorldXZ(col: number, row: number): { x: number; z: number } {
  const offset = ((GRID - 1) * SPACING) / 2;
  return { x: col * SPACING - offset, z: row * SPACING - offset };
}
