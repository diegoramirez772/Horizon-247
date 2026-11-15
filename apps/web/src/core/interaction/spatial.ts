// Spatial navigation (doc «Interacción v2» §2.3): the focus jumps to the nearest control in the direction asked,
// like on a TV. One algorithm for arrow keys, a gamepad, a TV remote, a switch and the hand. Pure on rectangles.

export type Dir = "up" | "down" | "left" | "right";
export interface Box { x: number; y: number; w: number; h: number }

/**
 * Index of the best candidate from `from` going `dir`, or -1. Candidates must lie in that half-plane; the cost
 * weights distance along the direction once and the sideways offset 3× (stay in the same row or column),
 * and prefers boxes that overlap the source on the other axis.
 */
export function nextInDirection(boxes: Box[], from: Box, dir: Dir): number {
  const cx = from.x + from.w / 2, cy = from.y + from.h / 2;
  let best = -1, bestCost = Infinity;
  boxes.forEach((b, i) => {
    if (b === from || (b.x === from.x && b.y === from.y && b.w === from.w && b.h === from.h)) return;
    const bx = b.x + b.w / 2, by = b.y + b.h / 2;
    let along: number, side: number, overlap: boolean;
    switch (dir) {
      case "right": along = b.x - (from.x + from.w); side = Math.abs(by - cy); overlap = b.y < from.y + from.h && b.y + b.h > from.y; if (bx <= cx) return; break;
      case "left": along = from.x - (b.x + b.w); side = Math.abs(by - cy); overlap = b.y < from.y + from.h && b.y + b.h > from.y; if (bx >= cx) return; break;
      case "down": along = b.y - (from.y + from.h); side = Math.abs(bx - cx); overlap = b.x < from.x + from.w && b.x + b.w > from.x; if (by <= cy) return; break;
      case "up": along = from.y - (b.y + b.h); side = Math.abs(bx - cx); overlap = b.x < from.x + from.w && b.x + b.w > from.x; if (by >= cy) return; break;
    }
    const cost = Math.max(0, along) + side * (overlap ? 1 : 3) + (overlap ? 0 : 40);
    if (cost < bestCost) { bestCost = cost; best = i; }
  });
  return best;
}

/** Index of the box nearest to a point within `radius` px (magnet for the hand pointer), or -1. */
export function nearestTo(boxes: Box[], x: number, y: number, radius: number): number {
  let best = -1, bestD = radius;
  boxes.forEach((b, i) => {
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
    const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
    const d = Math.hypot(dx, dy);
    if (d < bestD || (d === 0 && bestD === 0 && best < 0)) { bestD = d; best = i; }
  });
  return best;
}
