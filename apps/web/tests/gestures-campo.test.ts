import { describe, expect, it } from "vitest";
import { fieldParams, GESTURE_PARAMS, GestureMachine, reachFrom, type Hand, type HandEvent } from "@/core/interaction/gestures";

// Synthetic hands: wrist at the bottom, middle knuckle above it (hand size 0.2). `up` = index, middle, ring, pinky.
const TIP_X = [0.42, 0.52, 0.56, 0.6];
function shape(up: [boolean, boolean, boolean, boolean], dx = 0, dy = 0): Hand {
  const h: Hand = Array.from({ length: 21 }, () => ({ x: 0.5 + dx, y: 0.75 + dy }));
  h[0] = { x: 0.5 + dx, y: 0.9 + dy }; h[9] = { x: 0.5 + dx, y: 0.7 + dy }; h[5] = { x: 0.46 + dx, y: 0.7 + dy };
  ([[8, 6], [12, 10], [16, 14], [20, 18]] as const).forEach(([tip, pip], i) => {
    if (up[i]) { h[pip] = { x: TIP_X[i] + dx, y: 0.6 + dy }; h[tip] = { x: TIP_X[i] + dx, y: 0.45 + dy }; }
    else { h[pip] = { x: 0.5 + dx, y: 0.66 + dy }; h[tip] = { x: 0.5 + dx, y: 0.76 + dy }; }
  });
  h[2] = { x: 0.4 + dx, y: 0.8 + dy }; h[3] = { x: 0.35 + dx, y: 0.76 + dy }; h[4] = { x: 0.3 + dx, y: 0.72 + dy };
  return h;
}
const point = (dx = 0, dy = 0) => shape([true, false, false, false], dx, dy);
const open = (dx = 0, dy = 0) => shape([true, true, true, true], dx, dy);

/** Index up, thumb on the tip of a half-extended middle finger: the one-hand zoom grip. */
function grip(dy: number): Hand {
  const h = point(0, dy);
  h[12] = { x: 0.42, y: 0.62 + dy }; h[10] = { x: 0.46, y: 0.66 + dy };
  h[4] = { x: 0.43, y: 0.63 + dy };
  return h;
}

function run(g: GestureMachine, frames: [Hand[], number][]): HandEvent[] {
  return frames.flatMap(([h, t]) => g.step(h, t));
}
const types = (ev: HandEvent[]) => ev.map((e) => e.type);

describe("gestos de campo", () => {
  it("an open hand swept fast to the right is one swipe right, not a back", () => {
    const g = new GestureMachine(GESTURE_PARAMS, false);
    const ev = run(g, [0, 1, 2, 3, 4, 5].map((i) => [[open(-0.15 + i * 0.07)], i * 66]));
    const sw = ev.filter((e) => e.type === "swipe");
    expect(sw).toEqual([{ type: "swipe", dir: "right" }]);
    expect(types(ev)).not.toContain("back");
  });

  it("an upward sweep is a swipe up", () => {
    const g = new GestureMachine(GESTURE_PARAMS, false);
    const ev = run(g, [0, 1, 2, 3, 4].map((i) => [[open(0, 0.05 - i * 0.07)], i * 66]));
    expect(ev.find((e) => e.type === "swipe")).toEqual({ type: "swipe", dir: "up" });
  });

  it("✌️ held still 1 s asks «what is here» at the pointer; three fingers marks a report", () => {
    const v = new GestureMachine(GESTURE_PARAMS, false);
    const ev = run(v, Array.from({ length: 13 }, (_, i) => [[shape([true, true, false, false])], i * 100] as [Hand[], number]));
    expect(types(ev)).toContain("info");
    expect(ev.find((e) => e.type === "pointer" && e.pose === "two")).toBeTruthy();
    const t3 = new GestureMachine(GESTURE_PARAMS, false);
    const ev3 = run(t3, Array.from({ length: 13 }, (_, i) => [[shape([true, true, true, false])], i * 100] as [Hand[], number]));
    expect(types(ev3)).toContain("mark");
    expect(types(ev3)).not.toContain("info");
  });

  it("thumb on the middle finger and raising the hand zooms in; the pointer does not move", () => {
    const g = new GestureMachine(GESTURE_PARAMS, false);
    const p0 = g.step([point()], 0).find((e) => e.type === "pointer");
    const ev = run(g, [[[grip(0)], 100], [[grip(-0.05)], 200], [[grip(-0.1)], 300]]);
    const zooms = ev.filter((e) => e.type === "zoom");
    expect(zooms.length).toBe(2);
    expect(zooms.every((z) => z.type === "zoom" && z.factor > 1)).toBe(true);
    const ps = ev.filter((e) => e.type === "pointer");
    expect(ps.every((p) => p.type === "pointer" && p0?.type === "pointer" && p.x === p0.x && p.pose === "zoom")).toBe(true);
    expect(types(ev)).not.toContain("tap");
  });

  it("a pointing hand with the thumb resting on the curled middle finger is not a zoom", () => {
    const g = new GestureMachine(GESTURE_PARAMS, false);
    const h = point();
    h[4] = { x: 0.5, y: 0.77 }; // thumb on the curled middle fingertip
    const ev = run(g, [[[h], 0], [[point(0, -0.1)], 100]]);
    expect(types(ev)).not.toContain("zoom");
  });

  it("field profile: resting the pointer taps once and waits for the hand to move", () => {
    const g = new GestureMachine(fieldParams(), false);
    const still = run(g, Array.from({ length: 30 }, (_, i) => [[point()], i * 100] as [Hand[], number]));
    expect(still.filter((e) => e.type === "tap").length).toBe(1);
    expect(still.some((e) => e.type === "pointer" && e.pose === "dwell")).toBe(true);
    // without the field profile, resting never taps
    const n = new GestureMachine(GESTURE_PARAMS, false);
    expect(types(run(n, Array.from({ length: 30 }, (_, i) => [[point()], i * 100] as [Hand[], number])))).not.toContain("tap");
  });

  it("calibration turns the area the index travelled into the whole screen", () => {
    const g = new GestureMachine(GESTURE_PARAMS, false);
    g.calibrate(0, 1000);
    const frames: [Hand[], number][] = [];
    for (let i = 0; i < 20; i++) frames.push([[point(-0.1 + (i % 5) * 0.05, -0.1 + Math.floor(i / 5) * 0.05)], i * 50]);
    frames.push([[point()], 1100]);
    const cal = run(g, frames).find((e) => e.type === "calibrated");
    expect(cal && cal.type === "calibrated" ? cal.reach.x0 > 0.3 && cal.reach.x1 < 0.65 : false).toBe(true);
    expect(g.calibrating).toBe(false);
  });

  it("a barely moving hand does not calibrate", () => {
    expect(reachFrom(Array(20).fill(0.5), Array(20).fill(0.4))).toBeNull();
  });
});
