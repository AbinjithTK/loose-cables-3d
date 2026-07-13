import type { Vec2 } from '../types';

/**
 * Determines whether two open line segments P1->Q1 and P2->Q2 properly cross.
 *
 * "Properly" means the crossing point lies strictly inside both segments
 * (0 < t < 1 and 0 < u < 1). Shared endpoints and collinear overlaps do NOT
 * count as intersections, which matches puzzle intuition: two cables plugged
 * into the same port are not "tangled" at that shared port.
 */
export function segmentsIntersect(p1: Vec2, q1: Vec2, p2: Vec2, q2: Vec2): boolean {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;

  const denom = d1x * d2y - d1y * d2x;

  // Parallel or degenerate: no proper crossing.
  if (Math.abs(denom) < 1e-10) {
    return false;
  }

  const dpx = p2.x - p1.x;
  const dpy = p2.y - p1.y;

  const t = (dpx * d2y - dpy * d2x) / denom;
  const u = (dpx * d1y - dpy * d1x) / denom;

  return t > 0 && t < 1 && u > 0 && u < 1;
}

/**
 * Returns the parametric intersection point of two segments if they properly
 * cross, otherwise null. Useful for rendering the "over/under" gap and spark
 * effects at the exact crossing location.
 */
export function segmentIntersectionPoint(
  p1: Vec2,
  q1: Vec2,
  p2: Vec2,
  q2: Vec2
): Vec2 | null {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) {
    return null;
  }

  const dpx = p2.x - p1.x;
  const dpy = p2.y - p1.y;

  const t = (dpx * d2y - dpy * d2x) / denom;
  const u = (dpx * d1y - dpy * d1x) / denom;

  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) {
    return null;
  }

  return {
    x: p1.x + t * d1x,
    y: p1.y + t * d1y,
  };
}
