// Interaction level per device (doc «Interacción v2» §2.7), decided at start-up and lowered on the fly, like the
// visual tiers N0–N2 of the map: I0 universal · I1 light voice · I2 multimodal (camera) · I3 cloud (opt-in, not built).
// Plus the gamepad / TV-remote reader: polled only while a pad is connected (zero cost otherwise).

export type Level = 0 | 1 | 2 | 3;

export interface LevelInfo { level: Level; reason: string; gpuHands: boolean }

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

function renderer(): string {
  try {
    const gl = document.createElement("canvas").getContext("webgl") as WebGLRenderingContext | null;
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return r;
  } catch {
    return "";
  }
}

/** `?interaccion=0..2` forces a level (demo, testing on a strong machine as if it were a weak one). */
export function detectLevel(): LevelInfo {
  try {
    const q = new URLSearchParams(location.search).get("interaccion");
    if (q === "0" || q === "1" || q === "2") return { level: Number(q) as Level, reason: "forced", gpuHands: q === "2" };
  } catch { /* no location */ }
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const hasMic = !!navigator.mediaDevices?.getUserMedia;
  if (!hasMic) return { level: 0, reason: "no-media", gpuHands: false };
  if (n.connection?.saveData) return { level: 1, reason: "save-data", gpuHands: false };
  const cores = navigator.hardwareConcurrency || 2;
  const mem = n.deviceMemory ?? 4;
  const r = renderer();
  if (!r || SOFTWARE.test(r)) return { level: 1, reason: "no-gpu", gpuHands: false };
  // A «papa» (≤ 2 cores or ≤ 4 GB) still gets the camera, on CPU and only when the globe is still (doc §2.7).
  if (cores <= 2 || mem <= 4) return { level: 2, reason: "weak", gpuHands: false };
  return { level: 2, reason: "ok", gpuHands: true };
}

/** Low battery lowers the level (where the browser tells; Chromium only). */
export async function batteryLow(): Promise<boolean> {
  try {
    const b = await (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery?.();
    return !!b && !b.charging && b.level < 0.2;
  } catch {
    return false;
  }
}

// ---- gamepad / TV remote ----

export type PadEvent =
  | { type: "dir"; dir: "up" | "down" | "left" | "right" }
  | { type: "activate" } | { type: "back" } | { type: "talk" } | { type: "numbers" } | { type: "palette" }
  | { type: "orbit"; dx: number; dy: number } | { type: "zoom"; factor: number };

/** Standard mapping: A=0 B=1 X=2 Y=3, LT=6 RT=7, Back=8 Start=9, d-pad 12–15, sticks 0–3. */
export class Pads {
  private raf = 0;
  private prev: boolean[] = [];
  private repeatAt = 0;
  private held: string | null = null;
  private cleanup: (() => void)[] = [];
  onEvent: (e: PadEvent) => void = () => {};

  start(): void {
    const on = () => { if (!this.raf) this.loop(); };
    const off = () => { if (!navigator.getGamepads().some(Boolean)) this.halt(); };
    window.addEventListener("gamepadconnected", on);
    window.addEventListener("gamepaddisconnected", off);
    this.cleanup.push(() => window.removeEventListener("gamepadconnected", on), () => window.removeEventListener("gamepaddisconnected", off));
    if (navigator.getGamepads?.().some(Boolean)) on();
  }

  private halt(): void { cancelAnimationFrame(this.raf); this.raf = 0; }

  private loop = (): void => {
    const pad = navigator.getGamepads().find((p) => p && p.connected);
    if (!pad) { this.halt(); return; }
    const now = performance.now();
    const b = pad.buttons.map((x) => x.pressed);
    const edge = (i: number) => b[i] && !this.prev[i];
    if (edge(0)) this.onEvent({ type: "activate" });
    if (edge(1)) this.onEvent({ type: "back" });
    if (edge(2)) this.onEvent({ type: "numbers" });
    if (edge(3)) this.onEvent({ type: "talk" });
    if (edge(9)) this.onEvent({ type: "palette" });
    // d-pad (or left stick pushed hard) moves the focus, with key-repeat after 400 ms then every 140 ms
    const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
    const dir = b[12] || ay < -0.75 ? "up" : b[13] || ay > 0.75 ? "down" : b[14] || ax < -0.75 ? "left" : b[15] || ax > 0.75 ? "right" : null;
    if (dir && dir !== this.held) { this.onEvent({ type: "dir", dir }); this.repeatAt = now + 400; }
    else if (dir && now >= this.repeatAt) { this.onEvent({ type: "dir", dir }); this.repeatAt = now + 140; }
    this.held = dir;
    // right stick orbits the active view; triggers zoom
    const rx = pad.axes[2] ?? 0, ry = pad.axes[3] ?? 0;
    if (Math.abs(rx) > 0.15 || Math.abs(ry) > 0.15) this.onEvent({ type: "orbit", dx: rx * 0.012, dy: ry * 0.012 });
    const z = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
    if (Math.abs(z) > 0.1) this.onEvent({ type: "zoom", factor: 1 + z * 0.025 });
    this.prev = b;
    this.raf = requestAnimationFrame(this.loop);
  };

  stop(): void { this.halt(); for (const c of this.cleanup) c(); this.cleanup = []; }
}
