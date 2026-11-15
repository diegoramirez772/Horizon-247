// Procedural low-poly models. Each function adds one thing to a MeshBuilder at a position (x, y, z) with a rotation,
// a size and a seeded random source, so the same scene is always rebuilt identically.
// Units: 1 = 1 m. Shapes are stylised on purpose (H5): they illustrate a reading, they are not a measurement.

import { Anim, type Look, MeshBuilder, type RGBA, RX, RY, RZ, S, T, type Vec3, chain, mix, rgb, shade } from "./mesh";
import type { Breed, DeviceType, Role, Species } from "./spec";

type R = () => number;
const L = (color: RGBA, anim = 0, phase = 0, amount = 0): Look => ({ color, anim, phase, amount });

// ---------------- vegetation ----------------

export function grassTuft(mb: MeshBuilder, x: number, y: number, z: number, h: number, color: RGBA, wind: number, r: R): void {
  const ph = r() * 6.28;
  for (let k = 0; k < 3; k++) {
    const a = r() * Math.PI, w = 0.06 + r() * 0.05, hh = h * (0.7 + r() * 0.5);
    const dx = Math.cos(a) * w, dz = Math.sin(a) * w, lean = (r() - 0.5) * 0.25;
    mb.tri([x - dx, y, z - dz], [x + dx, y, z + dz], [x + lean, y + hh, z + lean * 0.5], L(shade(color, 0.85 + r() * 0.3), Anim.sway, ph, wind * 0.08));
  }
}

export function conifer(mb: MeshBuilder, x: number, y: number, z: number, h: number, leaf: RGBA, trunk: RGBA, wind: number, r: R): void {
  const ph = r() * 6.28;
  mb.cylinder(chain(T(x, y, z), S(0.18 * h / 8, h * 0.3, 0.18 * h / 8)), L(trunk), 1, 0.8, 5);
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const base = y + h * (0.22 + i * 0.22), rad = h * (0.26 - i * 0.06), th = h * 0.42;
    mb.cylinder(chain(T(x, base, z), RY(r() * 3), S(rad, th, rad)), L(shade(leaf, 0.9 + i * 0.08), Anim.sway, ph, wind * 0.012 * (i + 1)), 1, 0, 7);
  }
}

export function broadleaf(mb: MeshBuilder, x: number, y: number, z: number, h: number, leaf: RGBA, trunk: RGBA, wind: number, r: R): void {
  const ph = r() * 6.28;
  mb.cylinder(chain(T(x, y, z), S(0.16 * h / 6, h * 0.55, 0.16 * h / 6)), L(trunk), 1, 0.7, 5);
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28, d = h * 0.18 * r();
    const s = h * (0.22 + r() * 0.12);
    mb.sphere(chain(T(x + Math.cos(a) * d, y + h * (0.62 + r() * 0.2), z + Math.sin(a) * d), S(s, s * 0.8, s)), L(shade(leaf, 0.85 + r() * 0.3), Anim.sway, ph, wind * 0.02), 6, 4);
  }
}

/** Mesquite / huizache: short crooked trunk, wide flat crown. */
export function mesquite(mb: MeshBuilder, x: number, y: number, z: number, h: number, leaf: RGBA, trunk: RGBA, wind: number, r: R): void {
  const ph = r() * 6.28, lean = (r() - 0.5) * 0.5;
  mb.cylinder(chain(T(x, y, z), RZ(lean), S(0.12 * h / 4, h * 0.5, 0.12 * h / 4)), L(trunk), 1, 0.6, 5);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.28 + r(), d = h * 0.3;
    const s = h * (0.3 + r() * 0.12);
    mb.sphere(chain(T(x + Math.cos(a) * d - lean * h * 0.4, y + h * 0.62 + r() * 0.2, z + Math.sin(a) * d), S(s, s * 0.38, s)), L(shade(leaf, 0.85 + r() * 0.25), Anim.sway, ph, wind * 0.015), 6, 3);
  }
}

export function nopal(mb: MeshBuilder, x: number, y: number, z: number, h: number, color: RGBA, r: R): void {
  const pad = (px: number, py: number, pz: number, rot: number, s: number, depth: number): void => {
    mb.sphere(chain(T(px, py, pz), RY(rot), RZ((r() - 0.5) * 0.5), S(s * 0.55, s * 0.75, s * 0.14)), L(shade(color, 0.9 + r() * 0.2)), 6, 4);
    if (depth <= 0) return;
    const k = 1 + Math.floor(r() * 2);
    for (let i = 0; i < k; i++) pad(px + (r() - 0.5) * s * 0.8, py + s * 1.1, pz + (r() - 0.5) * s * 0.3, rot + (r() - 0.5) * 0.8, s * 0.85, depth - 1);
  };
  pad(x, y + h * 0.3, z, r() * 3, h * 0.35, 2);
}

export function agave(mb: MeshBuilder, x: number, y: number, z: number, h: number, color: RGBA, r: R): void {
  const n = 9 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + r() * 0.3, tilt = 0.5 + r() * 0.6;
    mb.cylinder(chain(T(x, y, z), RY(a), RZ(tilt), S(0.09 * h, h * (0.8 + r() * 0.4), 0.04 * h)), L(shade(color, 0.85 + r() * 0.3)), 1, 0, 4, false);
  }
}

export function maize(mb: MeshBuilder, x: number, y: number, z: number, h: number, color: RGBA, wind: number, r: R): void {
  const ph = r() * 6.28;
  mb.cylinder(chain(T(x, y, z), S(0.035, h, 0.035)), L(shade(color, 0.9), Anim.sway, ph, wind * 0.05), 1, 0.7, 4, false);
  for (let i = 0; i < 4; i++) {
    const a = r() * 6.28, yy = y + h * (0.3 + i * 0.15);
    mb.cylinder(chain(T(x, yy, z), RY(a), RZ(1.0 + r() * 0.4), S(0.06, h * 0.45, 0.015)), L(shade(color, 0.95 + r() * 0.2), Anim.sway, ph, wind * 0.06), 1, 0, 3, false);
  }
}

export function palm(mb: MeshBuilder, x: number, y: number, z: number, h: number, leaf: RGBA, trunk: RGBA, wind: number, r: R): void {
  const ph = r() * 6.28, lean = (r() - 0.5) * 0.35;
  mb.cylinder(chain(T(x, y, z), RZ(lean), S(0.18, h, 0.18)), L(trunk), 1, 0.7, 6);
  const tx = x - Math.sin(lean) * h, ty = y + Math.cos(lean) * h;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * 6.28;
    mb.cylinder(chain(T(tx, ty, z), RY(a), RZ(1.9 + r() * 0.3), S(0.35, h * 0.45, 0.06)), L(shade(leaf, 0.9 + r() * 0.2), Anim.sway, ph, wind * 0.05), 1, 0, 3, false);
  }
}

export function deadTree(mb: MeshBuilder, x: number, y: number, z: number, h: number, color: RGBA, r: R): void {
  mb.cylinder(chain(T(x, y, z), S(0.14, h, 0.14)), L(color), 1, 0.4, 5);
  for (let i = 0; i < 4; i++) {
    const a = r() * 6.28;
    mb.cylinder(chain(T(x, y + h * (0.4 + r() * 0.4), z), RY(a), RZ(0.7 + r() * 0.5), S(0.05, h * 0.35, 0.05)), L(color), 1, 0.2, 4, false);
  }
}

export function rock(mb: MeshBuilder, x: number, y: number, z: number, s: number, color: RGBA, r: R): void {
  mb.sphere(chain(T(x, y + s * 0.25, z), RY(r() * 6), RX((r() - 0.5) * 0.6), S(s * (0.8 + r() * 0.5), s * (0.5 + r() * 0.4), s * (0.8 + r() * 0.4))), L(shade(color, 0.85 + r() * 0.3)), 5, 3);
}

// ---------------- weather and hazards ----------------

export function cloud(mb: MeshBuilder, x: number, y: number, z: number, s: number, color: RGBA, storm: boolean, r: R): void {
  const ph = r() * 6.28;
  const look = (k: number) => L(shade(color, k), Anim.drift, ph, 1.5 + s * 0.15);
  const SEG = 9, RINGS = 5;
  const n = 5 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28, d = s * 0.55 * r();
    const rr = s * (0.35 + r() * 0.3);
    mb.sphere(chain(T(x + Math.cos(a) * d * 1.4, y + rr * 0.25 + r() * s * 0.25, z + Math.sin(a) * d), S(rr, rr * 0.75, rr)), look(0.92 + r() * 0.12), SEG, RINGS);
  }
  // flat darker base
  mb.sphere(chain(T(x, y, z), S(s * 0.95, s * 0.12, s * 0.75)), look(0.78), 8, 3);
  if (storm) {
    // cumulonimbus: tall tower and a flat anvil on top
    mb.cylinder(chain(T(x, y, z), S(s * 0.55, s * 2.2, s * 0.5)), look(0.85), 0.9, 0.7, 8);
    mb.sphere(chain(T(x + s * 0.3, y + s * 2.3, z), S(s * 1.6, s * 0.22, s * 1.1)), look(1.0), 9, 3);
  }
}

/** Rain streaks; they fall in the vertex shader from `top` and loop (uFallH). */
export function rain(mb: MeshBuilder, n: number, half: number, top: number, color: RGBA, speed: number, r: R): void {
  for (let i = 0; i < n; i++) {
    const x = (r() * 2 - 1) * half, z = (r() * 2 - 1) * half, y = top * (0.4 + r() * 0.6), len = 0.5 + r() * 0.4;
    const ph = r() * 100, w = 0.025;
    const look: Look = { color, anim: Anim.fall, phase: ph, amount: speed * (0.85 + r() * 0.3), nrm: [0, y, 0] };
    mb.tri([x - w, y, z], [x + w, y, z], [x, y - len, z], look);
    mb.tri([x, y, z - w], [x, y, z + w], [x, y - len, z], look);
  }
}

export function snow(mb: MeshBuilder, n: number, half: number, top: number, r: R): void {
  for (let i = 0; i < n; i++) {
    const x = (r() * 2 - 1) * half, z = (r() * 2 - 1) * half, y = top * (0.3 + r() * 0.7), s = 0.07 + r() * 0.05;
    const look: Look = { color: rgb("#ffffff", 0.95), anim: Anim.snow, phase: r() * 100, amount: 1.2 + r() * 0.6, nrm: [0, y, 0] };
    mb.tri([x - s, y, z], [x + s, y, z], [x, y + s * 1.5, z], look);
    mb.tri([x - s, y, z], [x, y - s * 1.5, z], [x + s, y, z], look);
  }
}

export function lightning(mb: MeshBuilder, x: number, top: number, z: number, r: R): void {
  let px = x, py = top, pz = z;
  const ph = r() * 10;
  const look = L(rgb("#f4f1ff"), Anim.flash, ph, 1);
  while (py > 0.5) {
    const nx = px + (r() - 0.5) * 2.2, ny = py - 1.2 - r() * 1.6, nz = pz + (r() - 0.5) * 2.2;
    const len = Math.hypot(nx - px, ny - py, nz - pz);
    const mid: Vec3 = [(px + nx) / 2, (py + ny) / 2, (pz + nz) / 2];
    const yaw = Math.atan2(nx - px, nz - pz), pitch = Math.acos((ny - py) / len);
    mb.box(chain(T(mid[0], mid[1], mid[2]), RY(yaw), RX(pitch), S(0.09, len, 0.09)), look);
    px = nx; py = Math.max(0, ny); pz = nz;
  }
}

export function flame(mb: MeshBuilder, x: number, y: number, z: number, h: number, r: R): void {
  const ph = r() * 6.28;
  mb.cylinder(chain(T(x, y, z), RY(r() * 3), S(h * 0.35, h, h * 0.35)), L(rgb("#ff5a1a"), Anim.flame, ph, h * 0.25), 1, 0, 6);
  mb.cylinder(chain(T(x, y, z), RY(r() * 3), S(h * 0.2, h * 0.7, h * 0.2)), L(rgb("#ffc53a"), Anim.flame, ph + 1, h * 0.2), 1, 0, 5);
}

/** Smoke puffs that rise and loop; `drift` leans the plume with the wind. */
export function smoke(clear: MeshBuilder, x: number, y: number, z: number, n: number, dark: number, wind: number, r: R): void {
  for (let i = 0; i < n; i++) {
    const s = 0.8 + r() * 1.4;
    const c = mix(rgb("#cfcac4", 0.5), rgb("#4a4642", 0.6), dark);
    clear.sphere(chain(T(x + (r() - 0.5) * 1.2, y + r() * 2, z + (r() - 0.5) * 1.2), S(s)), L(c, Anim.rise, r() * 20, 1 + wind * 0.05), 6, 4);
  }
}

export function dust(clear: MeshBuilder, n: number, half: number, color: RGBA, speed: number, r: R): void {
  for (let i = 0; i < n; i++) {
    const x = (r() * 2 - 1) * half, z = (r() * 2 - 1) * half, y = 0.3 + r() * 5, s = 0.12 + r() * 0.3;
    const look: Look = { color: shade(color, 0.8 + r() * 0.4), anim: Anim.blow, phase: r() * 100, amount: speed * (0.7 + r() * 0.6), nrm: [x, 0, 0] };
    clear.tri([x - s, y, z], [x + s, y + s * 0.4, z], [x, y + s, z + s * 0.5], look);
  }
}

/** Dust devil: a twisted column of dust grains (Mars and dry plains). */
export function dustDevil(clear: MeshBuilder, x: number, z: number, h: number, color: RGBA, r: R): void {
  for (let i = 0; i < 90; i++) {
    const t = i / 90, a = t * 18 + r(), rad = 0.3 + t * 1.8;
    const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad, py = t * h, s = 0.2 + t * 0.3;
    clear.tri([px - s, py, pz], [px + s, py + s * 0.3, pz], [px, py + s, pz + s * 0.4], L(shade(color, 0.85 + r() * 0.3), Anim.drift, 0, 2));
  }
}

/** Soft round shadow under something (transparent pass). */
export function blob(clear: MeshBuilder, x: number, y: number, z: number, rx: number, rz: number): void {
  const n = 10, c = L([0, 0, 0, 0.28]);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28, b = ((i + 1) / n) * 6.28;
    clear.tri([x, y + 0.04, z], [x + Math.cos(b) * rx, y + 0.04, z + Math.sin(b) * rz], [x + Math.cos(a) * rx, y + 0.04, z + Math.sin(a) * rz], c);
  }
}

// ---------------- animals ----------------

const BREEDS: Record<Breed, { body: string; face: string; belly: string; patches?: string }> = {
  hereford: { body: "#8a3b1f", face: "#f3eee6", belly: "#f3eee6" },
  angus: { body: "#1d1b1a", face: "#1d1b1a", belly: "#26221f" },
  charolais: { body: "#e9dfc8", face: "#efe7d4", belly: "#e2d6bc" },
  holstein: { body: "#f4f2ee", face: "#f4f2ee", belly: "#f4f2ee", patches: "#151515" },
  criollo: { body: "#9a6a3c", face: "#7d5330", belly: "#c49a6a" },
};

export interface AnimalLook { species: Species; breed?: Breed; collar?: boolean; head?: "up" | "down" | "lying" }

/** Quadruped from boxes: proportions change with the species, colours with the breed. Faces −Z → rotated by `yaw`. */
export function quadruped(mb: MeshBuilder, x: number, y: number, z: number, yaw: number, a: AnimalLook, r: R): void {
  const sp = a.species;
  const P = {
    vaca: { L: 2.0, W: 0.75, H: 0.75, leg: 0.75, neck: 0.35, head: 0.5, horns: false },
    toro: { L: 2.2, W: 0.9, H: 0.9, leg: 0.75, neck: 0.4, head: 0.55, horns: true },
    becerro: { L: 1.1, W: 0.45, H: 0.45, leg: 0.55, neck: 0.25, head: 0.35, horns: false },
    borrego: { L: 1.1, W: 0.65, H: 0.6, leg: 0.45, neck: 0.25, head: 0.3, horns: false },
    cabra: { L: 1.0, W: 0.45, H: 0.5, leg: 0.55, neck: 0.35, head: 0.3, horns: true },
    caballo: { L: 1.9, W: 0.6, H: 0.75, leg: 1.05, neck: 0.8, head: 0.6, horns: false },
  }[sp];
  const br = BREEDS[a.breed ?? (sp === "caballo" ? "criollo" : sp === "borrego" ? "charolais" : "hereford")];
  const body = rgb(sp === "borrego" ? "#ece6d8" : sp === "cabra" ? "#c9b49a" : br.body);
  const face = rgb(sp === "borrego" ? "#2a2522" : sp === "cabra" ? "#efe9df" : br.face);
  const legC = rgb(sp === "borrego" ? "#2a2522" : br.body);
  const ph = r() * 6.28;
  const lying = a.head === "lying";
  const legH = lying ? 0.05 : P.leg;
  const M = (...ms: ReturnType<typeof T>[]) => chain(T(x, y, z), RY(yaw), ...ms);
  const breathe = (c: RGBA) => L(c, Anim.breathe, ph, 0.02);
  // body
  if (sp === "borrego") {
    for (let i = 0; i < 5; i++) mb.sphere(M(T((r() - 0.5) * 0.25, legH + P.H * 0.55 + (r() - 0.5) * 0.1, -P.L * 0.4 + i * P.L * 0.2), S(P.W * 0.55)), breathe(shade(body, 0.92 + r() * 0.15)), 6, 4);
  } else {
    mb.box(M(T(0, legH + P.H / 2, 0), S(P.W, P.H, P.L)), breathe(body));
    mb.box(M(T(0, legH + P.H * 0.12, 0.05), S(P.W * 0.92, P.H * 0.25, P.L * 0.7)), breathe(rgb(br.belly)));
    if (br.patches && sp !== "caballo") for (let i = 0; i < 4; i++) {
      const side = r() < 0.5 ? -1 : 1;
      mb.box(M(T(side * P.W * 0.505, legH + P.H * (0.35 + r() * 0.4), (r() - 0.5) * P.L * 0.8), S(0.02, P.H * (0.25 + r() * 0.2), P.L * (0.15 + r() * 0.15))), breathe(rgb(br.patches)));
    }
  }
  // legs
  if (!lying) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    mb.box(M(T(sx * P.W * 0.32, legH / 2, sz * P.L * 0.38), S(P.W * 0.18, legH, P.W * 0.18)), L(legC));
    mb.box(M(T(sx * P.W * 0.32, 0.04, sz * P.L * 0.38 - 0.02), S(P.W * 0.2, 0.08, P.W * 0.22)), L(rgb("#2b2420")));
  }
  // neck + head; head down = grazing
  const down = a.head === "down";
  const neckY = legH + P.H * 0.8, neckZ = -P.L / 2;
  const tilt = sp === "caballo" ? (down ? 1.9 : 0.55) : down ? 1.4 : 0.35;
  mb.box(M(T(0, neckY, neckZ), RX(-tilt), T(0, P.neck / 2, 0), S(P.W * 0.5, P.neck + 0.2, P.W * 0.5)), breathe(body));
  const hy = neckY + Math.cos(tilt) * P.neck, hz = neckZ - Math.sin(tilt) * P.neck - 0.1;
  const headDown = down ? Math.max(0.15, hy - 0.4 - (sp === "caballo" ? 0.6 : 0)) : hy;
  mb.box(M(T(0, headDown, hz - P.head * 0.35), RX(down ? -1.1 : -0.25), S(P.W * 0.48, P.head * 0.55, P.head)), breathe(face));
  if (sp !== "caballo" && sp !== "borrego") {
    mb.box(M(T(0, headDown + P.head * 0.2, hz - P.head * 0.05), S(P.W * 0.85, 0.07, 0.12)), L(body)); // ears
  }
  if (P.horns) for (const s of [-1, 1]) mb.cylinder(M(T(s * P.W * 0.22, headDown + P.head * 0.3, hz), RZ(-s * (sp === "cabra" ? 0.3 : 1.2)), S(0.05, sp === "cabra" ? 0.35 : 0.3, 0.05)), L(rgb("#e8dcc2")), 1, 0.2, 4);
  if (sp === "caballo") mb.box(M(T(0, neckY + 0.3, neckZ + 0.08), RX(-tilt), S(0.08, P.neck + 0.3, 0.25)), L(rgb("#2a1a10"))); // mane
  // tail
  mb.box(M(T(0, legH + P.H * 0.55, P.L / 2 + 0.05), RX(0.25), T(0, -P.H * 0.35, 0), S(0.07, P.H * (sp === "caballo" ? 0.9 : 0.75), 0.07)), L(sp === "caballo" ? rgb("#2a1a10") : legC, Anim.sway, ph, 0.4));
  // GPS collar (device): small dark band + green light
  if (a.collar) {
    mb.box(M(T(0, neckY + 0.05, neckZ - 0.05), RX(-tilt), S(P.W * 0.58, 0.1, P.W * 0.58)), L(rgb("#2c3e50")));
    mb.box(M(T(0, neckY - 0.07, neckZ - 0.2), S(0.12, 0.1, 0.08)), L(rgb("#36e07a"), Anim.glow));
  }
}

// ---------------- people ----------------

const ROLE: Record<Role, { shirt: string; pants: string; hat?: "sombrero" | "casco" | "paja" | "gorra"; helmet?: boolean }> = {
  vaquero: { shirt: "#8c3b2e", pants: "#2f4a6d", hat: "sombrero" },
  agricultor: { shirt: "#e6dcc2", pants: "#5b4a36", hat: "paja" },
  brigadista: { shirt: "#e6a51c", pants: "#e6a51c", hat: "casco" },
  astronauta: { shirt: "#f2f2f0", pants: "#f2f2f0", helmet: true },
  cientifico: { shirt: "#f4f6f8", pants: "#33404d", hat: "gorra" },
  habitante: { shirt: "#3f7f8c", pants: "#2e2e38" },
};
const SKIN = ["#8d5a3b", "#b07a52", "#6e4429", "#c99572", "#9b6844"];

export function person(mb: MeshBuilder, x: number, y: number, z: number, yaw: number, role: Role, r: R): void {
  const k = ROLE[role];
  const ph = r() * 6.28;
  const skin = rgb(SKIN[Math.floor(r() * SKIN.length)]);
  const M = (...ms: ReturnType<typeof T>[]) => chain(T(x, y, z), RY(yaw), ...ms);
  const b = (c: RGBA) => L(c, Anim.breathe, ph, 0.012);
  const h = role === "astronauta" ? 1.0 : 0.96;
  for (const s of [-1, 1]) {
    mb.box(M(T(s * 0.11, 0.42 * h, 0), S(0.16 * h, 0.84 * h, 0.18 * h)), L(rgb(k.pants)));
    mb.box(M(T(s * 0.11, 0.04, -0.03), S(0.17, 0.09, 0.26)), L(rgb(role === "astronauta" ? "#c9c9c9" : "#3a2a1e")));
  }
  mb.box(M(T(0, 1.12 * h, 0), S(0.42 * h, 0.6 * h, 0.24 * h)), b(rgb(k.shirt)));
  for (const s of [-1, 1]) mb.box(M(T(s * 0.27 * h, 1.12 * h, 0), RZ(s * 0.12), S(0.12 * h, 0.58 * h, 0.13 * h)), b(rgb(k.shirt)));
  const headY = 1.58 * h;
  if (k.helmet) {
    mb.box(M(T(0, 1.15, 0.2), S(0.38, 0.5, 0.18)), b(rgb("#d9d9d6"))); // life-support pack
    mb.sphere(M(T(0, headY, 0), S(0.2)), b(rgb("#f2f2f0")), 8, 6);
    mb.sphere(M(T(0, headY, -0.08), S(0.15, 0.12, 0.13)), L(rgb("#d8a23a"), Anim.glow), 7, 4); // gold visor
    return;
  }
  mb.box(M(T(0, headY, 0), S(0.22, 0.26, 0.22)), b(skin));
  if (role === "brigadista") mb.box(M(T(0, 1.16, 0.13), S(0.36, 0.08, 0.02)), L(rgb("#e8e8e8"))); // reflective band
  if (k.hat === "sombrero") {
    mb.cylinder(M(T(0, headY + 0.1, 0), S(0.36, 0.03, 0.36)), L(rgb("#c8b088")), 1, 1, 10);
    mb.cylinder(M(T(0, headY + 0.12, 0), S(0.14, 0.16, 0.14)), L(rgb("#c8b088")), 1, 0.85, 8);
  } else if (k.hat === "paja") {
    mb.cylinder(M(T(0, headY + 0.1, 0), S(0.3, 0.12, 0.3)), L(rgb("#e0c77a")), 1, 0.35, 9);
  } else if (k.hat === "casco") {
    mb.sphere(M(T(0, headY + 0.08, 0), S(0.17, 0.12, 0.17)), L(rgb("#f2c400")), 7, 3);
  } else if (k.hat === "gorra") {
    mb.box(M(T(0, headY + 0.14, 0), S(0.24, 0.06, 0.24)), L(rgb("#2f5d8a")));
    mb.box(M(T(0, headY + 0.12, -0.15), S(0.2, 0.02, 0.12)), L(rgb("#2f5d8a")));
  }
}

// ---------------- devices and structures ----------------

export function device(mb: MeshBuilder, clear: MeshBuilder, type: DeviceType, x: number, y: number, z: number, yaw: number, r: R, night = false): void {
  const M = (...ms: ReturnType<typeof T>[]) => chain(T(x, y, z), RY(yaw), ...ms);
  const metal = rgb("#9aa3ab"), dark = rgb("#2d3640"), panel = rgb("#1f3b63");
  switch (type) {
    case "estacion": {
      mb.cylinder(M(S(0.05, 3, 0.05)), L(metal), 1, 1, 5);
      mb.box(M(T(0, 1.4, 0.12), S(0.3, 0.4, 0.15)), L(rgb("#e9ecef")));
      mb.box(M(T(0, 2.2, 0.2), RX(-0.6), S(0.5, 0.03, 0.35)), L(panel));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * 6.28;
        mb.box(M(T(0, 3.0, 0), RY(a), T(0.18, 0, 0), S(0.36, 0.02, 0.02)), L(metal, Anim.drift, i, 0));
        mb.sphere(M(T(0, 3.0, 0), RY(a), T(0.36, 0, 0), S(0.05)), L(metal), 5, 3);
      }
      mb.box(M(T(0, 1.75, -0.05), S(0.05, 0.05, 0.05)), L(rgb("#36e07a"), Anim.glow));
      break;
    }
    case "sensor_suelo": {
      mb.cylinder(M(S(0.03, 0.6, 0.03)), L(metal), 1, 1, 4);
      mb.box(M(T(0, 0.65, 0), S(0.16, 0.12, 0.1)), L(rgb("#f4b23c")));
      mb.box(M(T(0, 0.73, -0.05), S(0.03, 0.03, 0.03)), L(rgb("#36e07a"), Anim.glow));
      break;
    }
    case "molino": {
      const H = 7;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        mb.cylinder(chain(T(x + sx * 0.9, y, z + sz * 0.9), RZ(-sx * 0.12), RX(sz * 0.12), S(0.05, H, 0.05)), L(metal), 1, 1, 4);
      }
      for (let k = 1; k < 5; k++) { const w = 1.8 * (1 - k / 6); mb.box(chain(T(x, y + (H * k) / 5, z), S(w, 0.04, 0.04)), L(metal)); mb.box(chain(T(x, y + (H * k) / 5, z), S(0.04, 0.04, w)), L(metal)); }
      const hub = M(T(0, H + 0.2, -0.3));
      for (let i = 0; i < 12; i++) mb.box(chain(hub, RZ((i / 12) * 6.28), T(0, 0.75, 0), RY(0.4), S(0.22, 1.4, 0.02)), L(rgb("#d6d9dc")));
      mb.box(M(T(0, H + 0.2, 0.9), S(0.03, 0.8, 1.5)), L(rgb("#b8312f")));
      break;
    }
    case "bebedero": {
      mb.box(M(T(0, 0.3, 0), S(2.4, 0.6, 0.7)), L(rgb("#8f979e")));
      clear.box(M(T(0, 0.52, 0), S(2.2, 0.06, 0.55)), L(rgb("#4f8fbf", 0.85), Anim.wave, 0, 0.01));
      break;
    }
    case "corral": {
      const s = 7;
      const post = (px: number, pz: number) => mb.box(chain(T(x + px, y + 0.6, z + pz), S(0.12, 1.2, 0.12)), L(rgb("#6b4f35")));
      for (let i = 0; i <= 6; i++) { const t = -s / 2 + (i * s) / 6; post(t, -s / 2); post(t, s / 2); post(-s / 2, t); if (i < 2 || i > 4) post(s / 2, t); }
      for (const hh of [0.5, 1.0]) {
        mb.box(chain(T(x, y + hh, z - s / 2), S(s, 0.06, 0.04)), L(rgb("#8a6a48")));
        mb.box(chain(T(x, y + hh, z + s / 2), S(s, 0.06, 0.04)), L(rgb("#8a6a48")));
        mb.box(chain(T(x - s / 2, y + hh, z), S(0.04, 0.06, s)), L(rgb("#8a6a48")));
      }
      break;
    }
    case "casa": {
      mb.box(M(T(0, 1.3, 0), S(5, 2.6, 4)), L(rgb("#d9c7a8")));
      // gable roof
      const roof = rgb("#9c4a2f");
      const a: Vec3 = [-2.7, 2.6, -2.2], b: Vec3 = [2.7, 2.6, -2.2], c: Vec3 = [2.7, 2.6, 2.2], d: Vec3 = [-2.7, 2.6, 2.2], e: Vec3 = [-2.7, 3.9, 0], f: Vec3 = [2.7, 3.9, 0];
      const tr = (p: Vec3): Vec3 => { const m = M(); return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]]; };
      mb.quad(tr(a), tr(b), tr(f), tr(e), L(roof)); mb.quad(tr(d), tr(e), tr(f), tr(c), L(shade(roof, 0.85)));
      mb.tri(tr(a), tr(e), tr(d), L(rgb("#d9c7a8"))); mb.tri(tr(b), tr(c), tr(f), L(rgb("#d9c7a8")));
      mb.box(M(T(0.8, 0.9, -2.01), S(0.9, 1.8, 0.05)), L(rgb("#5a3a24")));
      const win = night ? L(rgb("#ffd27a"), Anim.glow) : L(rgb("#5e7f99"));
      mb.box(M(T(-1.2, 1.5, -2.01), S(0.9, 0.7, 0.05)), win);
      break;
    }
    case "panel_solar": {
      mb.cylinder(M(S(0.05, 1, 0.05)), L(metal), 1, 1, 4);
      mb.box(M(T(0, 1.1, 0), RX(-0.5), S(2.0, 0.05, 1.1)), L(panel));
      break;
    }
    case "presa": {
      mb.box(M(T(0, 0.5, 0), S(10, 1.6, 1.2)), L(rgb("#a39c8f")));
      break;
    }
    case "dron": {
      const hy = 4 + r() * 2;
      mb.box(M(T(0, hy, 0), S(0.35, 0.12, 0.35)), L(dark, Anim.breathe, r() * 6, 0.15));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * 6.28 + 0.785;
        mb.box(M(T(0, hy, 0), RY(a), T(0.35, 0, 0), S(0.45, 0.04, 0.05)), L(dark, Anim.breathe, 0, 0.15));
        mb.cylinder(M(T(Math.cos(a) * 0.55, hy + 0.05, Math.sin(a) * 0.55), S(0.2, 0.01, 0.2)), L(rgb("#c9d1d9", 0.9), Anim.breathe, 0, 0.15), 1, 1, 8);
      }
      mb.box(M(T(0, hy - 0.05, -0.18), S(0.06, 0.06, 0.06)), L(rgb("#ff3b30"), Anim.glow));
      break;
    }
    case "rover": {
      const bodyC = rgb("#e8e4dc");
      mb.box(M(T(0, 0.9, 0), S(1.6, 0.45, 2.4)), L(bodyC));
      for (const sx of [-1, 1]) for (const sz of [-0.9, 0, 0.9]) {
        mb.cylinder(M(T(sx * 0.95, 0.35, sz), RZ(Math.PI / 2), T(0, -0.15, 0), S(0.35, 0.3, 0.35)), L(rgb("#3b3b3b")), 1, 1, 8);
      }
      mb.box(M(T(0.4, 1.6, -0.9), S(0.1, 1.2, 0.1)), L(metal));
      mb.box(M(T(0.4, 2.25, -0.95), S(0.45, 0.25, 0.3)), L(bodyC));
      mb.box(M(T(0.4, 2.25, -1.11), S(0.3, 0.1, 0.02)), L(rgb("#3ad1ff"), Anim.glow));
      mb.box(M(T(0, 1.2, 0.6), S(1.8, 0.04, 1.4)), L(panel));
      break;
    }
    case "modulo": {
      mb.cylinder(M(S(3, 0.4, 3)), L(rgb("#bfc5cc")), 1, 1, 12);
      mb.sphere(M(T(0, 0.4, 0), S(3, 2.6, 3)), L(rgb("#eef0f2")), 12, 8);
      mb.box(M(T(0, 1.0, -2.9), S(1.2, 1.8, 0.6)), L(rgb("#c3c8ce")));
      mb.box(M(T(1.5, 2.0, -2.3), S(0.6, 0.3, 0.05)), L(rgb("#ffd27a"), Anim.glow));
      break;
    }
  }
}
