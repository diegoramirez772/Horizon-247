// Hand tracking for gestures (doc «Interacción v2» §2.6, level I2). Only while the user turns gestures on:
// camera at 320×240, MediaPipe Hand Landmarker (Apache-2.0) loaded from a pinned CDN build on first use and cached
// by the browser, adaptive rate (5–15 per second) so the globe keeps its frame budget. Pauses when the tab is hidden;
// stop() releases the camera (track.readyState === "ended") and frees the model.
// Field: with no hand in view for a while it drops to ~2 checks per second (rest) to save battery, and wakes up as
// soon as a hand appears. The rear camera can be used (tablet on a tripod or a stand facing the operator).
// It runs on the main thread: MediaPipe Tasks loads its Wasm with importScripts, which module workers do not have
// (moving it to a classic worker is pending and NOT verified).

const VERSION = "0.10.14";
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

interface Landmarker {
  detectForVideo(v: HTMLVideoElement, t: number): { landmarks: { x: number; y: number; z: number }[][] };
  close(): void;
}

/** A real browser import of a URL, out of the bundler's reach (it must not try to resolve or inline the CDN file). */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importUrl = new Function("u", "return import(u)") as (u: string) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface HandStats { status: "off" | "loading" | "on" | "error"; perSecond: number; inferMs: number; error?: string; resting?: boolean }
export type Facing = "user" | "environment";

/** No hand for this long → rest rate. */
const REST_AFTER_MS = 12000;
const REST_INTERVAL_MS = 450;

export class HandTracker {
  video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private lm: Landmarker | null = null;
  private timer = 0;
  private interval = 90;
  private times: number[] = [];
  private frames = 0;
  private since = 0;
  private alive = false;
  private lastHand = 0;
  stats: HandStats = { status: "off", perSecond: 0, inferMs: 0 };
  onStats: (s: HandStats) => void = () => {};

  private gpu: boolean;
  readonly facing: Facing;
  constructor(gpu: boolean, facing: Facing = "user") { this.gpu = gpu; this.facing = facing; }

  async start(onFrame: (hands: { x: number; y: number; z: number }[][], t: number) => void): Promise<void> {
    if (this.alive) return;
    this.alive = true;
    this.report({ status: "loading" });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: this.facing, frameRate: { ideal: 15, max: 30 } },
      });
      if (!this.alive) { this.release(); return; }
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.srcObject = this.stream;
      await v.play();
      this.video = v;
      // Loaded on demand from a pinned version; nothing is downloaded until gestures are turned on.
      const mod = await importUrl(`${CDN}/vision_bundle.mjs`);
      const files = await mod.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      const make = (delegate: "GPU" | "CPU") => mod.HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
      }) as Promise<Landmarker>;
      // The GPU path fails on some Linux drivers: fall back to the CPU instead of giving up.
      try { this.lm = await make(this.gpu ? "GPU" : "CPU"); } catch (e) { if (!this.gpu) throw e; this.lm = await make("CPU"); }
      if (!this.alive) { this.release(); return; }
      this.since = this.lastHand = performance.now();
      this.report({ status: "on", resting: false });
      const tick = () => {
        if (!this.alive) return;
        if (!document.hidden && this.video && this.lm && this.video.readyState >= 2) {
          const t0 = performance.now();
          const r = this.lm.detectForVideo(this.video, t0);
          const ms = performance.now() - t0;
          const hands = r.landmarks ?? [];
          if (hands.length) this.lastHand = t0;
          this.adapt(ms);
          const resting = t0 - this.lastHand > REST_AFTER_MS;
          if (resting) this.interval = REST_INTERVAL_MS;
          if (resting !== !!this.stats.resting) this.report({ resting });
          onFrame(hands, t0);
        }
        this.timer = window.setTimeout(tick, this.interval);
      };
      tick();
    } catch (e) {
      this.release();
      this.report({ status: "error", error: e instanceof Error ? e.name || e.message : "error" });
    }
  }

  /** Keeps inference under ~25 % of the time: interval = 4 × median inference, between 66 ms and 200 ms. */
  private adapt(ms: number): void {
    this.times.push(ms);
    if (this.times.length > 15) this.times.shift();
    const med = [...this.times].sort((a, b) => a - b)[this.times.length >> 1];
    this.interval = Math.max(66, Math.min(200, med * 4));
    this.frames++;
    const now = performance.now();
    if (now - this.since > 1000) {
      this.report({ status: "on", perSecond: Math.round((this.frames * 1000) / (now - this.since)), inferMs: Math.round(med) });
      this.frames = 0; this.since = now;
    }
  }

  private report(p: Partial<HandStats>): void {
    this.stats = { ...this.stats, ...p };
    this.onStats(this.stats);
  }

  private release(): void {
    clearTimeout(this.timer);
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    if (this.video) { this.video.srcObject = null; this.video = null; }
    try { this.lm?.close(); } catch { /* already closed */ }
    this.lm = null;
  }

  stop(): void {
    this.alive = false;
    this.release();
    this.report({ status: "off", perSecond: 0 });
  }
}
