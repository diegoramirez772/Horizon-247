// Verdict textures (SPEC §3, doc 03 §4), so verdicts read without colour:
//   1 PROBADO         → solid fill (effect colour)
//   2 CANDIDATA       → dots, 1.5 px every 6 px, no fill
//   3 NO_CONCLUYENTE  → 45° stripes, 1.5 px line every 6 px, ink = --text
//   4 SIN_CAMBIO ≥ δ  → flat grey
//   0 INSUFICIENTE    → transparent with thin border
// Tiles are drawn in device pixels, so they are scaled by devicePixelRatio to keep their CSS size.

const cache = new Map<string, HTMLCanvasElement>();

function tile(key: string, size: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  draw(c.getContext("2d")!);
  cache.set(key, c);
  return c;
}

/** Stripe tile: period 6 px measured across the stripes → tile side 6·√2 CSS px. */
export function stripeTile(ink: string, dpr: number): HTMLCanvasElement {
  const side = Math.round(6 * Math.SQRT2 * dpr);
  return tile(`stripe:${ink}:${side}`, side, (g) => {
    g.strokeStyle = ink;
    g.lineWidth = 1.5 * dpr;
    g.lineCap = "square";
    g.beginPath();
    // Three segments so the pattern joins seamlessly when repeated.
    g.moveTo(-side, 2 * side); g.lineTo(2 * side, -side);
    g.moveTo(-side, side); g.lineTo(side, -side);
    g.moveTo(0, 2 * side); g.lineTo(2 * side, 0);
    g.stroke();
  });
}

export function dotTile(ink: string, dpr: number): HTMLCanvasElement {
  const side = Math.round(6 * dpr);
  return tile(`dot:${ink}:${side}`, side, (g) => {
    g.fillStyle = ink;
    g.beginPath();
    g.arc(side / 2, side / 2, 0.75 * dpr * 1.1, 0, Math.PI * 2);
    g.fill();
  });
}

export function pattern(ctx: CanvasRenderingContext2D, which: "stripe" | "dot", ink: string, dpr: number): CanvasPattern {
  const t = which === "stripe" ? stripeTile(ink, dpr) : dotTile(ink, dpr);
  return ctx.createPattern(t, "repeat")!;
}
