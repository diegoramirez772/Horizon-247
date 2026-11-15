// Block-built («Minecraft-like») satellite models drawn on the globe's thin 2D layer: a handful of shaded boxes,
// sorted back to front, no WebGL and no assets. Level of detail is decided by the caller: a dot when far, a small
// glyph in between, and this model only when the camera is close. Size is exaggerated on purpose (a real satellite
// would be under one pixel); the card says so.

type V3 = [number, number, number];
/** A box: centre, size, colour (#rrggbb). Model axes: x = across (panels), y = along track, z = up (away from Earth). */
type Box = { c: V3; s: V3; col: string };

const GOLD = "#c8a03a", PANEL = "#2f5aa8", PANEL_ISS = "#b9873a", WHITE = "#e8ecf2", GREY = "#9aa3ad", DARK = "#3a414a";

const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, col: string): Box => ({ c: [cx, cy, cz], s: [sx, sy, sz], col });

export type ModelKind = "iss" | "station" | "weather" | "observer" | "science";

const MODELS: Record<ModelKind, Box[]> = {
  iss: [
    box(0, 0, 0, 16, 0.7, 0.7, GREY), // truss
    ...[-7, -5, 5, 7].flatMap((x) => [box(x, 0, 2.6, 1.3, 0.15, 4.4, PANEL_ISS), box(x, 0, -2.6, 1.3, 0.15, 4.4, PANEL_ISS)]),
    box(0, 0.2, 0, 1.4, 7, 1.4, WHITE), // modules
    box(0, 3.8, 0, 2.4, 1.2, 1.2, WHITE),
    box(1.8, -1.6, 0, 2.2, 1.1, 1.1, WHITE),
    box(0, 0, 1.1, 3, 0.2, 1.6, "#d9dde3"), // radiator
  ],
  station: [
    box(0, 0, 0, 1.6, 6, 1.6, WHITE),
    box(-4, 0, 0, 5, 0.15, 2.2, PANEL), box(4, 0, 0, 5, 0.15, 2.2, PANEL),
    box(0, 3.4, 0, 2.2, 1, 2.2, GREY),
  ],
  weather: [
    box(0, 0, 0, 2, 3, 2, GOLD),
    box(-1.9, 0, 0, 0.12, 2.2, 6, PANEL), // one long wing
    box(0, 0, -1.3, 0.8, 0.8, 0.6, DARK), // instrument looking down
    box(0, 1.7, 0.4, 0.6, 0.6, 0.6, WHITE),
  ],
  observer: [
    box(0, 0, 0, 2, 2.6, 2.2, GOLD),
    box(-4, 0, 0, 5.6, 0.15, 2.2, PANEL), box(4, 0, 0, 5.6, 0.15, 2.2, PANEL),
    box(0, 0, -1.4, 1, 1, 0.6, DARK),
    box(0.6, -1.5, 0.8, 0.5, 0.5, 0.5, WHITE),
  ],
  science: [
    box(0, 0, 0, 2.4, 4.4, 2.4, WHITE),
    box(0, 2.5, 0, 2.6, 0.6, 2.6, DARK), // aperture
    box(-3.4, 0, 0, 4, 0.15, 2, PANEL), box(3.4, 0, 0, 4, 0.15, 2, PANEL),
  ],
};

export function modelFor(name: string, group: string): ModelKind {
  if (/^ISS \(ZARYA\)/.test(name)) return "iss";
  if (group === "stations") return "station";
  if (group === "weather") return "weather";
  if (group === "science") return "science";
  return "observer";
}

const FACES: { n: V3; idx: number[] }[] = [
  { n: [1, 0, 0], idx: [1, 3, 7, 5] }, { n: [-1, 0, 0], idx: [0, 4, 6, 2] },
  { n: [0, 1, 0], idx: [2, 6, 7, 3] }, { n: [0, -1, 0], idx: [0, 1, 5, 4] },
  { n: [0, 0, 1], idx: [4, 5, 7, 6] }, { n: [0, 0, -1], idx: [0, 2, 3, 1] },
];

function shade(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f(v >> 16)},${f((v >> 8) & 255)},${f(v & 255)})`;
}

/**
 * Draw a model centred at (x, y) on screen, `size` px across, turned to `headingDeg` (0 = screen up) and seen from
 * 35° above. `t` (seconds) adds a slow roll so a still satellite does not look frozen.
 */
export function drawModel(g: CanvasRenderingContext2D, kind: ModelKind, x: number, y: number, size: number, headingDeg: number, t = 0): void {
  const boxes = MODELS[kind];
  const yaw = (headingDeg * Math.PI) / 180, pitch = 0.62 + 0.05 * Math.sin(t * 0.4);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const k = size / (kind === "iss" ? 17 : 12);
  const view = (p: V3): V3 => {
    const rx = p[0] * cy - p[1] * sy, ry = p[0] * sy + p[1] * cy;
    return [rx, ry * cp - p[2] * sp, ry * sp + p[2] * cp]; // screen x, depth, screen up
  };
  const light: V3 = [-0.4, -0.5, 0.77];
  const drawn = boxes.map((b) => ({ b, d: view(b.c)[1] })).sort((p, q) => q.d - p.d);
  g.lineWidth = Math.max(0.5, size / 120);
  for (const { b } of drawn) {
    const corners: V3[] = [];
    for (let i = 0; i < 8; i++) corners.push(view([b.c[0] + (i & 1 ? 0.5 : -0.5) * b.s[0], b.c[1] + (i & 2 ? 0.5 : -0.5) * b.s[1], b.c[2] + (i & 4 ? 0.5 : -0.5) * b.s[2]]));
    for (const f of FACES) {
      const n = view(f.n);
      if (n[1] >= 0) continue; // facing away
      const lit = 0.5 + 0.55 * Math.max(0, f.n[0] * light[0] + f.n[1] * light[1] + f.n[2] * light[2]);
      g.fillStyle = shade(b.col, lit);
      g.strokeStyle = shade(b.col, lit * 0.6);
      g.beginPath();
      f.idx.forEach((i, j) => { const p = corners[i]; const px = x + p[0] * k, py = y - p[2] * k; if (j) g.lineTo(px, py); else g.moveTo(px, py); });
      g.closePath();
      g.fill();
      g.stroke();
    }
  }
}
