// Hand landmarks → the universal verbs (doc «Interacción v2» §2.3, §2.6) plus the field verbs (Gestos de campo).
// Pure state machine: feed it the 21 MediaPipe points per hand (x, y in 0..1 of the camera image) each frame; it emits
// pointer / tap / drag / zoom / back / confirm / swipe / info / mark. Hysteresis + hold times + a rearm period so
// holding a pose never fires a hundred actions.
// Every threshold here is a starting value to calibrate with real hands, NOT a measured result.

import { OneEuro } from "./oneeuro";

export interface Pt { x: number; y: number; z?: number }
export type Hand = Pt[]; // 21 landmarks

export interface Reach { x0: number; x1: number; y0: number; y1: number }
export type SwipeDir = "left" | "right" | "up" | "down";

export type HandEvent =
  | { type: "pointer"; x: number; y: number; pinching: boolean; pose: Pose; hold: number }
  | { type: "lost" }
  | { type: "tap"; x: number; y: number }
  | { type: "dragStart"; x: number; y: number }
  | { type: "drag"; x: number; y: number; dx: number; dy: number }
  | { type: "dragEnd" }
  | { type: "zoom"; factor: number }
  | { type: "back" }
  | { type: "confirm" }
  /** Open hand swept fast across the camera: the previous / next step (year, moment) or a page. */
  | { type: "swipe"; dir: SwipeDir }
  /** ✌️ held still: «what is here?», read aloud. */
  | { type: "info"; x: number; y: number }
  /** Three fingers held still: a field report at this point. */
  | { type: "mark"; x: number; y: number }
  /** 🤙 only the pinky up, briefly: start (or end) talking. Pointing and talking go together: «¿qué es esto?». */
  | { type: "talk" }
  | { type: "calibrated"; reach: Reach };

/** What the hand is doing right now, for the on-screen feedback (cursor ring and label). */
export type Pose = "point" | "pinch" | "palm" | "thumb" | "fist" | "two" | "three" | "zoom" | "dwell" | "talk" | null;

export const GESTURE_PARAMS = {
  /** Camera area mapped to the whole screen: you never have to reach the edge of the image. */
  reach: { x0: 0.18, x1: 0.82, y0: 0.15, y1: 0.75 } as Reach,
  pinchIn: 0.33,  // thumb–index distance / hand size to start a pinch
  pinchOut: 0.5,  // … and to release it (wide hysteresis: a shaky pinch does not flicker)
  tapMove: 0.045, // max pointer travel (screen fraction) after the fingers close for a pinch to count as a tap
  tapMs: 900,
  holdMs: 1000,   // held poses (palm, thumb, ✌️, three fingers) must be held this long, with the hand still
  holdMove: 0.05, // … moving more than this (screen fraction) restarts the hold: showing the hand never goes back
  rearmMs: 1500,  // after a held pose fires, no pose does anything for this long
  /** Swipe: the wrist travels this much of the camera width (or height) within `swipeMs`, mostly in one direction. */
  swipeDist: 0.2,
  swipeMs: 400,
  swipeCooldownMs: 700,
  /** One-hand zoom (thumb + middle finger): zoom factor per camera-height of vertical travel, as an exponent. */
  zoomGain: 4,
  /** Dwell click: the pointer rests this long on one spot = tap (0 = off). For gloves, where a pinch is unreliable. */
  dwellMs: 0,
  dwellMove: 0.025,
};
export type GestureParams = typeof GESTURE_PARAMS;

/** Field profile (gloves, arm's length, sun): bigger tolerances, dwell on, less arm travel. */
export function fieldParams(base: GestureParams = GESTURE_PARAMS): GestureParams {
  return {
    ...base,
    reach: shrink(base.reach, 0.06),
    pinchIn: 0.38, pinchOut: 0.56,
    tapMove: 0.045,
    holdMove: 0.07,
    dwellMs: 1200,
    dwellMove: 0.035,
  };
}

function shrink(r: Reach, m: number): Reach {
  return { x0: r.x0 + m, x1: r.x1 - m, y0: r.y0 + m, y1: r.y1 - m };
}

const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const size = (h: Hand) => d(h[0], h[9]) || 1e-3;

/** A finger is extended when its tip is farther from the wrist than its middle joint. */
function extended(h: Hand, tip: number, pip: number): boolean {
  return d(h[tip], h[0]) > d(h[pip], h[0]) * 1.12;
}

/** Which of index, middle, ring and pinky are extended. */
function fingers(h: Hand): [boolean, boolean, boolean, boolean] {
  return [extended(h, 8, 6), extended(h, 12, 10), extended(h, 16, 14), extended(h, 20, 18)];
}

export function isOpenPalm(h: Hand): boolean {
  const [i, m, r, p] = fingers(h);
  return i && m && r && p && d(h[4], h[5]) / size(h) > 0.55;
}

export function isThumbsUp(h: Hand): boolean {
  const [i, m, r, p] = fingers(h);
  return !i && !m && !r && !p && h[4].y < h[3].y && h[3].y < h[2].y && (h[2].y - h[4].y) / size(h) > 0.45;
}

/** Fist: every finger curled and the thumb tucked. Used as a clutch: the pointer freezes so you can re-centre your hand. */
export function isFist(h: Hand): boolean {
  const [i, m, r, p] = fingers(h);
  return !i && !m && !r && !p && d(h[4], h[9]) / size(h) < 0.75 && !isThumbsUp(h);
}

/** ✌️ index and middle up, ring and pinky curled, the two tips apart (not a pinch of the two). */
export function isVictory(h: Hand): boolean {
  const [i, m, r, p] = fingers(h);
  return i && m && !r && !p && d(h[8], h[12]) / size(h) > 0.25;
}

/** Index, middle and ring up, pinky curled. */
export function isThree(h: Hand): boolean {
  const [i, m, r, p] = fingers(h);
  return i && m && r && !p;
}

/** Only the pinky up (the «call me» hand without needing the thumb): talk. */
export function isPinky(h: Hand): boolean {
  const [i, m, r, p] = fingers(h);
  return !i && !m && !r && p;
}

/** At least three long fingers out: the hand counts as «open» for a swipe, whatever the thumb does. */
function isOpenish(h: Hand): boolean {
  return fingers(h).filter(Boolean).length >= 3;
}

export function pinchRatio(h: Hand): number {
  return d(h[4], h[8]) / size(h);
}

/** Thumb on the middle finger, index away: the one-hand zoom grip. */
export function middlePinchRatio(h: Hand): number {
  return d(h[4], h[12]) / size(h);
}

/** The middle fingertip is out in the air, not curled into the palm (where a pointing thumb rests on it). */
function middleOut(h: Hand): boolean {
  return d(h[12], h[0]) / size(h) > 1.2;
}

type HeldPose = "palm" | "thumb" | "two" | "three" | "talk";
/** Talking is frequent and the pinky pose is rare by accident: a shorter hold. */
const TALK_HOLD = 0.6;

export class GestureMachine {
  // Smoother at rest than the default (the laptop reads the hand only 5–10 times per second with the globe open),
  // still quick when the hand really moves (beta).
  private fx = new OneEuro(1.0, 0.3);
  private fy = new OneEuro(1.0, 0.3);
  /** Where the pointer was while the fingers were still open: a pinch taps THERE, not where closing them dragged the tip. */
  private open = { x: 0.5, y: 0.5 };
  /** Where the fingers closed: the drag threshold is measured from here. */
  private closed = { x: 0, y: 0 };
  /** Last raw index tip, to keep following the same hand when two are in view (MediaPipe's order is not stable). */
  private prevTip: { x: number; y: number } | null = null;
  private pinching = false;
  private pinchAt = 0;
  private start = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  private dragging = false;
  private poseSince = 0;
  private pose: HeldPose | null = null;
  private quietUntil = 0;
  private twoHand: number | null = null;
  private seen = false;
  private holdAt = { x: 0, y: 0 };
  private out = { x: 0.5, y: 0.5 };
  private off = { x: 0, y: 0 };
  private clutch = false;
  private zooming: number | null = null; // last camera y of the hand while holding the zoom grip
  private trail: { t: number; x: number; y: number }[] = [];
  private swipeUntil = 0;
  private dwell = { x: 0, y: 0, since: 0, armed: true };
  private calib: { until: number; xs: number[]; ys: number[] } | null = null;

  private p: GestureParams;
  private mirror: boolean;

  constructor(p: GestureParams = GESTURE_PARAMS, mirror = true) {
    this.p = p; this.mirror = mirror;
  }

  /** Field profile, calibration or camera change without losing the pointer. */
  configure(p: GestureParams, mirror = this.mirror): void {
    this.p = p; this.mirror = mirror;
  }

  /** Records where the index finger travels for `ms`; then the comfortable area becomes the whole screen. */
  calibrate(t: number, ms = 4000): void {
    this.calib = { until: t + ms, xs: [], ys: [] };
  }

  get calibrating(): boolean { return this.calib !== null; }

  /** `hands`: 0–2 hands this frame; `t` in ms. Returns the events of this frame. */
  step(hands: Hand[], t: number): HandEvent[] {
    const out: HandEvent[] = [];
    if (this.calib && t >= this.calib.until) {
      const r = reachFrom(this.calib.xs, this.calib.ys);
      this.calib = null;
      if (r) { this.p = { ...this.p, reach: r }; out.push({ type: "calibrated", reach: r }); }
    }
    if (!hands.length) {
      if (this.seen) { if (this.dragging) out.push({ type: "dragEnd" }); out.push({ type: "lost" }); }
      this.seen = false; this.pinching = false; this.dragging = false; this.twoHand = null; this.pose = null; this.prevTip = null;
      this.off = { x: 0, y: 0 }; this.clutch = false; this.zooming = null; this.trail = [];
      this.dwell = { x: 0, y: 0, since: 0, armed: true };
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

    // The same hand as before: the one whose index tip is nearest to the last one (a second hand never steals the pointer).
    let h = hands[0];
    if (hands.length > 1 && this.prevTip) {
      const pt = this.prevTip;
      h = hands.reduce((a, b) => (d(b[8], pt) < d(a[8], pt) ? b : a));
    }
    this.prevTip = { x: h[8].x, y: h[8].y };
    const r = this.p.reach;
    const rawX = this.mirror ? 1 - h[8].x : h[8].x;
    if (this.calib) { this.calib.xs.push(rawX); this.calib.ys.push(h[8].y); }
    const rx = this.fx.filter(clamp01((rawX - r.x0) / (r.x1 - r.x0)), t / 1000);
    const ry = this.fy.filter(clamp01((h[8].y - r.y0) / (r.y1 - r.y0)), t / 1000);
    // After a fist (clutch) or a zoom grip the hand may be somewhere else: keep the pointer and continue from there.
    if (this.clutch && !(!this.pinching && isFist(h))) { this.off = { x: this.out.x - rx, y: this.out.y - ry }; this.clutch = false; }
    const x = clamp01(rx + this.off.x);
    const y = clamp01(ry + this.off.y);
    const freeze = (pose: Pose) => out.push({ type: "pointer", x: this.out.x, y: this.out.y, pinching: false, pose, hold: 0 });

    // Fist = clutch: the pointer stays put while you move the hand back to a comfortable place.
    if (!this.pinching && isFist(h)) {
      this.pose = null; this.clutch = true; this.zooming = null;
      freeze("fist");
      return out;
    }

    // One-hand zoom: thumb on the middle finger (index away) and move the hand up = closer, down = farther.
    // For the field, where the other hand holds the tablet or a tool.
    if (!this.pinching) {
      const mid = middlePinchRatio(h), idx = pinchRatio(h);
      const grip = this.zooming !== null
        ? mid < this.p.pinchOut
        : mid < this.p.pinchIn && idx > this.p.pinchOut && middleOut(h) && extended(h, 8, 6);
      if (grip) {
        const cy = h[9].y;
        if (this.zooming !== null) {
          const f = Math.exp((this.zooming - cy) * this.p.zoomGain);
          if (Math.abs(f - 1) > 0.004) out.push({ type: "zoom", factor: f });
        }
        this.zooming = cy; this.pose = null; this.clutch = true; // the pointer resumes where it was
        freeze("zoom");
        return out;
      }
      this.zooming = null;
    }

    // Swipe: an open hand that travels fast, mostly in one direction. Checked before the held poses so a swipe
    // through an open palm never counts as «hold still».
    if (!this.pinching && isOpenish(h)) {
      const wx = this.mirror ? 1 - h[0].x : h[0].x, wy = h[0].y;
      this.trail.push({ t, x: wx, y: wy });
      while (this.trail.length && t - this.trail[0].t > this.p.swipeMs) this.trail.shift();
      const o = this.trail[0];
      const dx = wx - o.x, dy = wy - o.y;
      if (t >= this.swipeUntil && this.trail.length >= 2) {
        const dir: SwipeDir | null =
          Math.abs(dx) > this.p.swipeDist && Math.abs(dx) > 1.8 * Math.abs(dy) ? (dx > 0 ? "right" : "left")
          : Math.abs(dy) > this.p.swipeDist && Math.abs(dy) > 1.8 * Math.abs(dx) ? (dy > 0 ? "down" : "up")
          : null;
        if (dir) {
          this.swipeUntil = t + this.p.swipeCooldownMs;
          this.quietUntil = Math.max(this.quietUntil, t + this.p.swipeCooldownMs);
          this.trail = []; this.pose = null;
          out.push({ type: "swipe", dir });
          this.out = { x, y };
          out.unshift({ type: "pointer", x, y, pinching: false, pose: "palm", hold: 0 });
          return out;
        }
      }
    } else this.trail = [];

    // Poses held still: open palm = back, thumbs up = confirm, ✌️ = what is here, three fingers = mark a report.
    const pose: HeldPose | null = !this.pinching && t >= this.quietUntil
      ? (isOpenPalm(h) ? "palm" : isThumbsUp(h) ? "thumb" : isVictory(h) ? "two" : isThree(h) ? "three" : isPinky(h) ? "talk" : null)
      : null;
    let hold = 0;
    if (pose !== this.pose || (pose && Math.hypot(x - this.holdAt.x, y - this.holdAt.y) > this.p.holdMove)) {
      this.pose = pose; this.poseSince = t; this.holdAt = { x, y };
    } else if (pose) {
      hold = Math.min(1, (t - this.poseSince) / (this.p.holdMs * (pose === "talk" ? TALK_HOLD : 1)));
      if (hold >= 1) {
        const at = { x: this.out.x, y: this.out.y };
        out.push(pose === "palm" ? { type: "back" } : pose === "thumb" ? { type: "confirm" } : pose === "talk" ? { type: "talk" } : { type: pose === "two" ? "info" : "mark", ...at });
        this.pose = null;
        this.quietUntil = t + this.p.rearmMs;
        return out;
      }
    }
    // While ✌️ or three fingers are held, the pointer stays where the pose began: it marks THAT point.
    if (pose === "two" || pose === "three" || pose === "talk") {
      out.push({ type: "pointer", x: this.out.x, y: this.out.y, pinching: false, pose, hold });
      return out;
    }

    // Pinch with hysteresis: short and still = tap (activate); otherwise a drag (move).
    const pr = pinchRatio(h);
    if (!this.pinching && pr > this.p.pinchOut) this.open = { x, y };
    if (!this.pinching && pr < this.p.pinchIn) {
      // The tip travels toward the thumb while closing: the target is where it pointed while still open.
      this.pinching = true; this.pinchAt = t; this.start = { ...this.open }; this.closed = { x, y }; this.last = { x, y };
    } else if (this.pinching && pr > this.p.pinchOut) {
      this.pinching = false;
      if (this.dragging) out.push({ type: "dragEnd" });
      else if (t - this.pinchAt <= this.p.tapMs) out.push({ type: "tap", x: this.start.x, y: this.start.y });
      this.dragging = false;
      this.dwell = { x, y, since: t, armed: false }; // a pinch already tapped: the dwell waits for the hand to move
    }
    if (this.pinching) {
      if (!this.dragging && Math.hypot(x - this.closed.x, y - this.closed.y) > this.p.tapMove) {
        this.dragging = true;
        out.push({ type: "dragStart", x: this.start.x, y: this.start.y });
      }
      if (this.dragging) out.push({ type: "drag", x, y, dx: x - this.last.x, dy: y - this.last.y });
      this.last = { x, y };
    }

    // Dwell (field profile): resting the pointer on one spot taps it once; it rearms when the pointer moves away.
    let dwellHold = 0;
    if (this.p.dwellMs > 0 && !this.pinching && !pose) {
      const moved = Math.hypot(x - this.dwell.x, y - this.dwell.y);
      if (moved > this.p.dwellMove * (this.dwell.armed ? 1 : 2)) this.dwell = { x, y, since: t, armed: true };
      else if (this.dwell.armed) {
        dwellHold = Math.min(1, (t - this.dwell.since) / this.p.dwellMs);
        if (dwellHold >= 1) {
          out.push({ type: "tap", x: this.dwell.x, y: this.dwell.y });
          this.dwell.armed = false;
          dwellHold = 0;
        }
      }
    }

    // While pinching, the pointer stays where the pinch began until it becomes a drag (a pinch should not slide off its target).
    this.out = { x: this.pinching && !this.dragging ? this.start.x : x, y: this.pinching && !this.dragging ? this.start.y : y };
    const shown: Pose = this.pinching ? "pinch" : pose ?? (dwellHold > 0.15 ? "dwell" : "point");
    out.unshift({ type: "pointer", ...this.out, pinching: this.pinching, pose: shown, hold: pose ? hold : dwellHold > 0.15 ? dwellHold : 0 });
    return out;
  }
}

/** The comfortable area from where the index travelled during calibration (trimmed 5 % on each side, with a margin). */
export function reachFrom(xs: number[], ys: number[]): Reach | null {
  if (xs.length < 8) return null;
  const q = (a: number[], f: number) => { const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))]; };
  let x0 = q(xs, 0.05), x1 = q(xs, 0.95), y0 = q(ys, 0.05), y1 = q(ys, 0.95);
  // too little travel = the hand barely moved: keep the previous area
  if (x1 - x0 < 0.15 || y1 - y0 < 0.12) return null;
  const mx = (x1 - x0) * 0.06, my = (y1 - y0) * 0.06;
  x0 += mx; x1 -= mx; y0 += my; y1 -= my;
  return { x0: clamp01(x0), x1: clamp01(x1), y0: clamp01(y0), y1: clamp01(y1) };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
