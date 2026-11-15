// Hand landmarks → the five universal verbs (doc «Interacción v2» §2.3, §2.6). Pure state machine: feed it the
// 21 MediaPipe points per hand (x, y in 0..1 of the camera image) each frame; it emits pointer / tap / drag / zoom /
// back / confirm. Hysteresis + hold times + a rearm period so holding a pose never fires a hundred actions.
// Every threshold here is a starting value to calibrate with real hands, NOT a measured result.

import { OneEuro } from "./oneeuro";

export interface Pt { x: number; y: number; z?: number }
export type Hand = Pt[]; // 21 landmarks

export type HandEvent =
  | { type: "pointer"; x: number; y: number; pinching: boolean; pose: Pose; hold: number }
  | { type: "lost" }
  | { type: "tap"; x: number; y: number }
  | { type: "dragStart"; x: number; y: number }
  | { type: "drag"; x: number; y: number; dx: number; dy: number }
  | { type: "dragEnd" }
  | { type: "zoom"; factor: number }
  | { type: "back" }
  | { type: "confirm" };

/** What the hand is doing right now, for the on-screen feedback (cursor ring and label). */
export type Pose = "point" | "pinch" | "palm" | "thumb" | "fist" | null;

export const GESTURE_PARAMS = {
  /** Camera area mapped to the whole screen: you never have to reach the edge of the image. */
  reach: { x0: 0.18, x1: 0.82, y0: 0.15, y1: 0.75 },
  pinchIn: 0.33,  // thumb–index distance / hand size to start a pinch
  pinchOut: 0.5,  // … and to release it (wide hysteresis: a shaky pinch does not flicker)
  tapMove: 0.03,  // max pointer travel (screen fraction) for a pinch to count as a tap
  tapMs: 700,
  holdMs: 1000,   // open palm / thumbs up must be held this long, with the hand still
  holdMove: 0.05, // … moving more than this (screen fraction) restarts the hold: showing the hand never goes back
  rearmMs: 1500,  // after back/confirm, the same pose does nothing for this long
};

const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const size = (h: Hand) => d(h[0], h[9]) || 1e-3;

/** A finger is extended when its tip is farther from the wrist than its middle joint. */
function extended(h: Hand, tip: number, pip: number): boolean {
  return d(h[tip], h[0]) > d(h[pip], h[0]) * 1.12;
}

export function isOpenPalm(h: Hand): boolean {
  return extended(h, 8, 6) && extended(h, 12, 10) && extended(h, 16, 14) && extended(h, 20, 18) && d(h[4], h[5]) / size(h) > 0.55;
}

export function isThumbsUp(h: Hand): boolean {
  const curled = !extended(h, 8, 6) && !extended(h, 12, 10) && !extended(h, 16, 14) && !extended(h, 20, 18);
  return curled && h[4].y < h[3].y && h[3].y < h[2].y && (h[2].y - h[4].y) / size(h) > 0.45;
}

/** Fist: every finger curled and the thumb tucked. Used as a clutch: the pointer freezes so you can re-centre your hand. */
export function isFist(h: Hand): boolean {
  return !extended(h, 8, 6) && !extended(h, 12, 10) && !extended(h, 16, 14) && !extended(h, 20, 18) && d(h[4], h[9]) / size(h) < 0.75 && !isThumbsUp(h);
}

export function pinchRatio(h: Hand): number {
  return d(h[4], h[8]) / size(h);
}

export class GestureMachine {
  private fx = new OneEuro();
  private fy = new OneEuro();
  private pinching = false;
  private pinchAt = 0;
  private start = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  private dragging = false;
  private poseSince = 0;
  private pose: "palm" | "thumb" | null = null;
  private quietUntil = 0;
  private twoHand: number | null = null;
  private seen = false;
  private holdAt = { x: 0, y: 0 };
  private out = { x: 0.5, y: 0.5 };
  private off = { x: 0, y: 0 };
  private clutch = false;

  private p: typeof GESTURE_PARAMS;
  private mirror: boolean;

  constructor(p = GESTURE_PARAMS, mirror = true) {
    this.p = p; this.mirror = mirror;
  }

  /** `hands`: 0–2 hands this frame; `t` in ms. Returns the events of this frame. */
  step(hands: Hand[], t: number): HandEvent[] {
    const out: HandEvent[] = [];
    if (!hands.length) {
      if (this.seen) { if (this.dragging) out.push({ type: "dragEnd" }); out.push({ type: "lost" }); }
      this.seen = false; this.pinching = false; this.dragging = false; this.twoHand = null; this.pose = null;
      this.off = { x: 0, y: 0 }; this.clutch = false;
      this.fx.reset(); this.fy.reset();
      return out;
    }
    this.seen = true;

    // Two hands pinching → zoom by the change of distance between them.
    if (hands.length >= 2 && pinchRatio(hands[0]) < this.p.pinchIn && pinchRatio(hands[1]) < this.p.pinchIn) {
      const sep = d(hands[0][8], hands[1][8]);
      if (this.twoHand !== null && sep > 0.01) {
        const f = sep / this.twoHand;
        if (Math.abs(f - 1) > 0.004) out.push({ type: "zoom", factor: f });
      }
      this.twoHand = sep;
      return out;
    }
    this.twoHand = null;

    const h = hands[0];
    const r = this.p.reach;
    const rawX = this.mirror ? 1 - h[8].x : h[8].x;
    const rx = this.fx.filter(clamp01((rawX - r.x0) / (r.x1 - r.x0)), t / 1000);
    const ry = this.fy.filter(clamp01((h[8].y - r.y0) / (r.y1 - r.y0)), t / 1000);
    // After a fist (clutch) the hand may be somewhere else: keep the pointer where it was and continue from there.
    if (this.clutch && !(!this.pinching && isFist(h))) { this.off = { x: this.out.x - rx, y: this.out.y - ry }; this.clutch = false; }
    const x = clamp01(rx + this.off.x);
    const y = clamp01(ry + this.off.y);

    // Fist = clutch: the pointer stays put while you move the hand back to a comfortable place.
    if (!this.pinching && isFist(h)) {
      this.pose = null; this.clutch = true;
      out.push({ type: "pointer", x: this.out.x, y: this.out.y, pinching: false, pose: "fist", hold: 0 });
      return out;
    }

    // Poses (held still): open palm = back, thumbs up = confirm. Never while pinching.
    const pose = !this.pinching && t >= this.quietUntil ? (isOpenPalm(h) ? "palm" : isThumbsUp(h) ? "thumb" : null) : null;
    let hold = 0;
    if (pose !== this.pose || (pose && Math.hypot(x - this.holdAt.x, y - this.holdAt.y) > this.p.holdMove)) {
      this.pose = pose; this.poseSince = t; this.holdAt = { x, y };
    } else if (pose) {
      hold = Math.min(1, (t - this.poseSince) / this.p.holdMs);
      if (hold >= 1) {
        out.push({ type: pose === "palm" ? "back" : "confirm" });
        this.pose = null;
        this.quietUntil = t + this.p.rearmMs;
        return out;
      }
    }

    // Pinch with hysteresis: short and still = tap (activate); otherwise a drag (move).
    const pr = pinchRatio(h);
    if (!this.pinching && pr < this.p.pinchIn) {
      this.pinching = true; this.pinchAt = t; this.start = { x, y }; this.last = { x, y };
    } else if (this.pinching && pr > this.p.pinchOut) {
      this.pinching = false;
      if (this.dragging) out.push({ type: "dragEnd" });
      else if (t - this.pinchAt <= this.p.tapMs) out.push({ type: "tap", x: this.start.x, y: this.start.y });
      this.dragging = false;
    }
    if (this.pinching) {
      if (!this.dragging && Math.hypot(x - this.start.x, y - this.start.y) > this.p.tapMove) {
        this.dragging = true;
        out.push({ type: "dragStart", x: this.start.x, y: this.start.y });
      }
      if (this.dragging) out.push({ type: "drag", x, y, dx: x - this.last.x, dy: y - this.last.y });
      this.last = { x, y };
    }
    // While pinching, the pointer stays where the pinch began until it becomes a drag (a pinch should not slide off its target).
    this.out = { x: this.pinching && !this.dragging ? this.start.x : x, y: this.pinching && !this.dragging ? this.start.y : y };
    out.unshift({ type: "pointer", ...this.out, pinching: this.pinching, pose: this.pinching ? "pinch" : pose ?? "point", hold });
    return out;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
