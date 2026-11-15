// Interaction layer, pure parts (doc «Interacción v2» §4.7): spoken numbers, tolerant matching, dictation safety,
// interpretation order, spatial navigation and the hand state machine.

import { describe, expect, it } from "vitest";
import { applyDictation, punctuate } from "./dictation";
import { phonetic, rank, saysOneOf, similarity } from "./fuzzy";
import { GestureMachine, type Hand } from "./gestures";
import { interpret, type InterpretCtx } from "./interpret";
import { spokenToDigits } from "./numbers";
import { nearestTo, nextInDirection } from "./spatial";

const ctx = (over: Partial<InterpretCtx> = {}): InterpretCtx => ({ mode: "commands", pendingConfirm: false, labels: [], hasManip: true, ...over });

describe("spoken numbers", () => {
  it("reads Spanish years and counts", () => {
    expect(spokenToDigits("muestrame el ano dos mil diez")).toBe("muestrame el ano 2010");
    expect(spokenToDigits("mil novecientos ochenta y uno")).toBe("1981");
    expect(spokenToDigits("veinticinco anos")).toBe("25 anos");
    expect(spokenToDigits("cuarenta y cinco anos")).toBe("45 anos");
    expect(spokenToDigits("dos mil veinticuatro")).toBe("2024");
  });
  it("reads English years both ways", () => {
    expect(spokenToDigits("nineteen eighty one")).toBe("1981");
    expect(spokenToDigits("twenty ten")).toBe("2010");
    expect(spokenToDigits("two thousand twenty four")).toBe("2024");
  });
  it("leaves articles and plain words alone", () => {
    expect(spokenToDigits("una alerta nueva")).toBe("una alerta nueva");
    expect(spokenToDigits("y luego")).toBe("y luego");
  });
});

describe("tolerant matching", () => {
  it("folds the confusions of recognisers", () => {
    expect(phonetic("vaya")).toBe(phonetic("balla"));
    expect(phonetic("zona")).toBe(phonetic("sona"));
    expect(phonetic("hielo")).toBe(phonetic("ielo"));
    expect(similarity("duranco", "durango")).toBeGreaterThan(0.8);
  });
  it("ranks and refuses far phrases", () => {
    const r = rank("chiuaua", ["chihuahua", "durango", "sonora"], (x) => [x]);
    expect(r[0].item).toBe("chihuahua");
    expect(rank("groenlandia", ["durango"], (x) => [x]).length).toBe(0);
    expect(saysOneOf("acercate", ["acercate"])).toBe(true);
    expect(saysOneOf("arriba", ["abajo"])).toBe(false);
  });
});

describe("dictation never runs commands", () => {
  it("writes «borrar todo y publicar» as text", () => {
    const r = applyDictation("", "borrar todo y publicar");
    expect(r.op).toBe("append");
    expect(r.text).toBe("Borrar todo y publicar");
  });
  it("turns spoken punctuation into signs and capitalizes", () => {
    expect(punctuate("hola coma qué tal punto")).toBe("hola, qué tal.");
    expect(applyDictation("Hola.", "abre interrogación llovió cierra interrogación").text).toBe("Hola. ¿Llovió?");
  });
  it("edits by whole-utterance commands", () => {
    expect(applyDictation("Primera frase. Segunda frase.", "borra la última frase").text).toBe("Primera frase.");
    expect(applyDictation("uno dos tres", "borra la última palabra").text).toBe("uno dos");
    expect(applyDictation("algo", "borra todo").text).toBe("");
    expect(applyDictation("cambio", "deshaz", "antes").text).toBe("antes");
  });
  it("replaces a number said in words", () => {
    const r = applyDictation("Subió 20 cm el río.", "cambia veinte por treinta");
    expect(r.op).toBe("replace");
    expect(r.text).toBe("Subió 30 cm el río.");
  });
});

describe("interpretation order", () => {
  it("interface commands and numbers", () => {
    expect(interpret("muestra números", ctx())).toEqual({ k: "meta", what: "numbersOn" });
    expect(interpret("siete", ctx())).toEqual({ k: "number", n: 7 });
    expect(interpret("toca el doce", ctx())).toEqual({ k: "number", n: 12 });
  });
  it("moves the active view", () => {
    expect(interpret("acércate", ctx())).toMatchObject({ k: "manip", what: "zoomIn", times: 1 });
    expect(interpret("gira a la derecha dos veces", ctx())).toMatchObject({ k: "manip", what: "right", times: 2 });
    expect(interpret("aleja mucho", ctx())).toMatchObject({ k: "manip", what: "zoomOut", times: 3 });
    expect(interpret("acércate", ctx({ hasManip: false })).k).toBe("assistant");
  });
  it("system operations, with deixis and ordinals", () => {
    expect(interpret("vigila esto", ctx())).toMatchObject({ k: "system", what: "watch", deixis: true });
    expect(interpret("reconoce la alerta dos", ctx())).toMatchObject({ k: "system", what: "ack", ordinal: 2 });
    expect(interpret("cierra la alerta", ctx())).toMatchObject({ k: "system", what: "closeAlert" });
    expect(interpret("mis alertas", ctx())).toMatchObject({ k: "system", what: "alerts" });
  });
  it("a visible control by its name, tolerant", () => {
    const labels = [{ n: 1, name: "Mapa" }, { n: 2, name: "Experto" }, { n: 3, name: "Nueva conversación" }];
    expect(interpret("abre mapa", ctx({ labels }))).toEqual({ k: "label", n: 1 });
    expect(interpret("nueva conversacion", ctx({ labels }))).toEqual({ k: "label", n: 3 });
    expect(interpret("ezperto", ctx({ labels }))).toEqual({ k: "label", n: 2 });
  });
  it("questions go to the assistant with digits", () => {
    expect(interpret("¿qué pasó en Durango en dos mil diez?", ctx())).toEqual({ k: "assistant", text: "que paso en durango en 2010" });
  });
  it("confirmation only when one is pending", () => {
    expect(interpret("sí", ctx({ pendingConfirm: true }))).toEqual({ k: "confirm", yes: true });
    expect(interpret("cancela", ctx({ pendingConfirm: true }))).toEqual({ k: "confirm", yes: false });
  });
  it("in dictation, only «orden:» and the dictation controls are commands", () => {
    expect(interpret("muestra números", ctx({ mode: "dictation" }))).toEqual({ k: "dictation", raw: "muestra números" });
    expect(interpret("listo", ctx({ mode: "dictation" }))).toEqual({ k: "meta", what: "dictateEnd" });
    expect(interpret("orden: muestra números", ctx({ mode: "dictation" }))).toEqual({ k: "meta", what: "numbersOn" });
  });
});

describe("spatial navigation", () => {
  const grid = [
    { x: 0, y: 0, w: 50, h: 20 }, { x: 100, y: 0, w: 50, h: 20 }, { x: 200, y: 0, w: 50, h: 20 },
    { x: 0, y: 100, w: 50, h: 20 }, { x: 100, y: 100, w: 50, h: 20 },
  ];
  it("stays in the row / column", () => {
    expect(nextInDirection(grid, grid[0], "right")).toBe(1);
    expect(nextInDirection(grid, grid[1], "down")).toBe(4);
    expect(nextInDirection(grid, grid[4], "up")).toBe(1);
    expect(nextInDirection(grid, grid[0], "left")).toBe(-1);
  });
  it("magnet picks the nearest within the radius", () => {
    expect(nearestTo(grid, 160, 10, 30)).toBe(1);
    expect(nearestTo(grid, 500, 500, 30)).toBe(-1);
  });
});

describe("hand state machine", () => {
  // A synthetic open hand; pinch moves the thumb tip onto the index tip.
  function hand(ix: number, iy: number, pinch: boolean): Hand {
    const h: Hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8 }));
    h[0] = { x: 0.5, y: 0.9 }; h[9] = { x: 0.5, y: 0.7 };
    h[5] = { x: 0.45, y: 0.7 }; h[6] = { x: ix, y: iy + 0.1 }; h[8] = { x: ix, y: iy };
    h[2] = { x: 0.4, y: 0.8 }; h[3] = { x: 0.38, y: 0.78 };
    h[4] = pinch ? { x: ix + 0.01, y: iy + 0.01 } : { x: 0.3, y: 0.75 };
    return h;
  }
  it("a short still pinch is a tap", () => {
    const g = new GestureMachine(undefined, false);
    g.step([hand(0.5, 0.4, false)], 0);
    g.step([hand(0.5, 0.4, true)], 33);
    const ev = g.step([hand(0.5, 0.4, false)], 200);
    expect(ev.some((e) => e.type === "tap")).toBe(true);
  });
  it("a moving pinch is a drag, not a tap", () => {
    const g = new GestureMachine(undefined, false);
    g.step([hand(0.5, 0.4, false)], 0);
    g.step([hand(0.5, 0.4, true)], 33);
    let all = g.step([hand(0.6, 0.4, true)], 66);
    all = all.concat(g.step([hand(0.7, 0.4, true)], 99), g.step([hand(0.7, 0.4, false)], 130));
    expect(all.some((e) => e.type === "dragStart")).toBe(true);
    expect(all.some((e) => e.type === "dragEnd")).toBe(true);
    expect(all.some((e) => e.type === "tap")).toBe(false);
  });
  it("losing the hand ends a drag", () => {
    const g = new GestureMachine(undefined, false);
    g.step([hand(0.5, 0.4, true)], 0);
    g.step([hand(0.7, 0.4, true)], 33);
    const ev = g.step([], 66);
    expect(ev.map((e) => e.type)).toEqual(["dragEnd", "lost"]);
  });
});
