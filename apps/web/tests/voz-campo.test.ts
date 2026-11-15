import { describe, expect, it } from "vitest";
import { normalize } from "@/core/assistant/patterns";
import { afterWake, bestAlternative } from "@/core/interaction/hub";
import { interpret, type InterpretCtx } from "@/core/interaction/interpret";
import { GESTURE_PARAMS, GestureMachine, type Hand } from "@/core/interaction/gestures";

const ctx: InterpretCtx = { mode: "commands", pendingConfirm: false, labels: [], hasManip: true };
const k = (t: string) => interpret(t, ctx);

describe("voz de campo", () => {
  it("the wake word is stripped, alone it opens a window, absent it is null", () => {
    expect(afterWake(normalize("Horizon, acércate"))).toBe("acercate");
    expect(afterWake(normalize("Oye Horizon muéstrame Durango"))).toBe("muestrame durango");
    expect(afterWake(normalize("Horizon"))).toBe("");
    expect(afterWake(normalize("acércate"))).toBeNull();
  });

  it("n-best keeps the alternative that is a command", () => {
    const known = (t: string) => { const r = k(t).k; return r !== "assistant" && r !== "none"; };
    expect(bestAlternative(["a ser ca te mucho", "acercate mucho"], known)).toBe("acercate mucho");
    expect(bestAlternative(["como esta durango"], known)).toBe("como esta durango");
  });

  it("new phrases land on their own command, and old ones do not move", () => {
    expect(k("siguiente año")).toEqual({ k: "meta", what: "nextYear" });
    expect(k("año anterior")).toEqual({ k: "meta", what: "prevYear" });
    expect(k("siguiente")).toEqual({ k: "meta", what: "nextField" });
    expect(k("habla más lento")).toEqual({ k: "meta", what: "slower" });
    expect(k("más abajo")).toEqual({ k: "meta", what: "scrollDown" });
    expect(k("modo campo")).toEqual({ k: "meta", what: "fieldOn" });
    expect(k("quita modo campo")).toEqual({ k: "meta", what: "fieldOff" });
    expect(k("palabra de activación")).toEqual({ k: "meta", what: "wakeOn" });
    expect(k("calibra")).toEqual({ k: "meta", what: "calibrate" });
    expect(k("gestos")).toEqual({ k: "meta", what: "gesturesOn" });
    expect(k("acércate").k).toBe("manip");
  });

  it("🤙 only the pinky up, held briefly, is «talk»", () => {
    const h: Hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.75 }));
    h[0] = { x: 0.5, y: 0.9 }; h[9] = { x: 0.5, y: 0.7 }; h[5] = { x: 0.46, y: 0.7 };
    for (const [tip, pip] of [[8, 6], [12, 10], [16, 14]] as const) { h[pip] = { x: 0.5, y: 0.66 }; h[tip] = { x: 0.5, y: 0.76 }; }
    h[18] = { x: 0.6, y: 0.6 }; h[20] = { x: 0.6, y: 0.45 };
    h[2] = { x: 0.4, y: 0.8 }; h[3] = { x: 0.35, y: 0.76 }; h[4] = { x: 0.3, y: 0.72 };
    const g = new GestureMachine(GESTURE_PARAMS, false);
    const ev = Array.from({ length: 8 }, (_, i) => g.step([h], i * 100)).flat();
    expect(ev.filter((e) => e.type === "talk").length).toBe(1);
  });
});
