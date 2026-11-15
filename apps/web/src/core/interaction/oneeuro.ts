// One-Euro filter (Casiez, Roussel & Vogel, CHI 2012): removes jitter when the hand is still and adds almost no lag
// when it moves. Used for the hand pointer (doc «Interacción v2» §2.6). Parameters are to be calibrated, not measured yet.

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  private minCutoff: number;
  private beta: number;
  private dCutoff: number;

  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
  }

  /** `t` in seconds. */
  filter(value: number, t: number): number {
    if (this.x === null) { this.x = value; this.t = t; return value; }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const d = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (d - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset(): void { this.x = null; this.dx = 0; }
}
