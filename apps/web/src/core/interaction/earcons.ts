// State sounds (doc «Interacción v2» §2.5): rising = listening, double = understood, soft chord = done,
// low = could not, two equal = needs your OK. Synthesised with Web Audio on the spot: no files, near-zero cost.
// The audio context is created on the first sound (always after a user gesture) and suspended when idle.

export type Earcon = "listen" | "heard" | "done" | "error" | "confirm" | "tick";

const SEQ: Record<Earcon, [number, number, number][]> = {
  // [frequency Hz, start s, duration s]
  listen: [[587, 0, 0.07], [880, 0.07, 0.09]],
  heard: [[988, 0, 0.05], [988, 0.08, 0.05]],
  done: [[523, 0, 0.16], [659, 0.04, 0.16], [784, 0.08, 0.2]],
  error: [[330, 0, 0.12], [247, 0.12, 0.18]],
  confirm: [[659, 0, 0.08], [659, 0.14, 0.08]],
  tick: [[1320, 0, 0.025]],
};

let ac: AudioContext | null = null;
let idle = 0;
let enabled = true;

export function setEarcons(on: boolean): void { enabled = on; }
export function earconsOn(): boolean { return enabled; }

export function play(e: Earcon, volume = 0.05): void {
  if (!enabled || typeof window === "undefined") return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ac ??= new AC();
    if (ac.state === "suspended") void ac.resume();
    const t0 = ac.currentTime + 0.01;
    const out = ac.createGain();
    out.gain.value = volume;
    out.connect(ac.destination);
    let end = 0;
    for (const [f, s, d] of SEQ[e]) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + s);
      g.gain.linearRampToValueAtTime(1, t0 + s + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + s + d);
      o.connect(g).connect(out);
      o.start(t0 + s);
      o.stop(t0 + s + d + 0.02);
      end = Math.max(end, s + d);
    }
    clearTimeout(idle);
    idle = window.setTimeout(() => { void ac?.suspend(); }, (end + 2) * 1000);
  } catch { /* audio is a nicety; never break the action */ }
}
