// Design doc «Modos de profundidad… v2» §9: what is checked automatically, on a REAL home.json
// (zon home --place Durango Chihuahua --var T2M PRECTOTCORR, NASA POWER 1981–2026).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HomeDoc } from "@/contract/types";
import { parse } from "@/core/assistant/parse";
import { certaintyText, MEASURED } from "@/core/honesty/calibration";
import { limitsFor, shownLimits } from "@/core/honesty/limits";
import { markSeen, unseen } from "@/core/home/cursor";
import { attentionText, eventText, presentMonitor, staleSources, unknowns } from "@/core/home/present";
import { FORBIDDEN, REGISTERS, type Lang } from "@/core/i18n/texts";
import { effectiveMetric, stepRegister } from "@/core/state/store";

const doc = JSON.parse(readFileSync(new URL("./fixtures/home.json", import.meta.url), "utf8")) as HomeDoc;
const LANGS: Lang[] = ["es", "en"];
const monitors = doc.entities.flatMap((e) => e.monitors);
const numberIn = (s: string) => Number((s.match(/[+−-]?\d+(?:\.\d+)?/)?.[0] ?? "NaN").replace("−", "-"));

describe("one truth, three readings (doc v2 rule 1)", () => {
  it("the fixture is the real export", () => {
    expect(doc.kind).toBe("home");
    expect(monitors.length).toBe(4);
  });
  for (const mon of monitors) for (const lang of LANGS) {
    it(`${mon.id} · ${lang}: same verdict and same number in every level`, () => {
      const v = REGISTERS.map((r) => presentMonitor(mon, r, lang));
      expect(new Set(v.map((x) => x.verdict)).size).toBe(1);
      expect(new Set(v.map((x) => x.phrase)).size).toBe(1);
      for (const [i, x] of v.entries()) {
        expect(x.sentence).not.toMatch(/[{}]/);
        if (x.figure && mon.finding.effect !== null) {
          const tol = REGISTERS[i] === "sencillo" ? 0.05 : 0.005; // declared rounding: 1 decimal in Simple, 2 otherwise
          expect(Math.abs(Math.abs(numberIn(x.figure)) - Math.abs(mon.finding.effect))).toBeLessThanOrEqual(tol);
        }
      }
    });
    it(`${mon.id} · ${lang}: no level hides the main limit (rule 2)`, () => {
      const [s, n, t] = REGISTERS.map((r) => presentMonitor(mon, r, lang).limits);
      expect(s).toHaveLength(1);
      expect(n.length).toBeGreaterThanOrEqual(1);
      expect(t.length).toBeGreaterThanOrEqual(n.length);
      expect(n[0].key).toBe(s[0].key);
      expect(t[0].key).toBe(s[0].key);
    });
  }
  it("only Experto carries the diagnostic table (p, q, e) and Simple carries no capability line", () => {
    const m = monitors[0];
    expect(presentMonitor(m, "sencillo", "es").expert).toBeNull();
    expect(presentMonitor(m, "normal", "es").expert).toBeNull();
    expect(presentMonitor(m, "tecnico", "es").expert!.map(([k]) => k)).toContain("p · q");
    expect(presentMonitor(m, "sencillo", "es").capability).toBeNull();
  });
  it("the time machine says since when it is knowable (Durango temperature: 2011, measured)", () => {
    const dgo = monitors.find((m) => m.id.includes("durango-t2m"))!;
    expect(dgo.timeline?.consistent).toBe(true);
    expect(presentMonitor(dgo, "sencillo", "es").since).toBe("Se puede afirmar desde 2011.");
  });
});

describe("words (doc v2 §2.3, SPEC §5)", () => {
  const texts: string[] = [];
  for (const lang of LANGS) {
    for (const reg of REGISTERS) {
      texts.push(certaintyText(reg, lang));
      for (const mon of monitors) {
        const v = presentMonitor(mon, reg, lang);
        texts.push(v.sentence, v.figure ?? "", v.since ?? "", v.dataLine, v.capability ?? "", ...v.limits.map((l) => l.text[lang]));
      }
    }
    texts.push(...doc.events.map((e) => eventText(e, doc, lang)), ...unknowns(doc, lang));
    for (const ent of doc.entities) texts.push(...ent.state.priority.map((it) => attentionText(it, ent, lang)));
  }
  it("no forbidden word anywhere the home can say", () => {
    for (const s of texts) for (const re of FORBIDDEN) expect(s, `«${s}»`).not.toMatch(re);
  });
  it("units read as units (POWER «C» → «°C»)", () => {
    expect(presentMonitor(monitors[0], "normal", "es").figure).toContain("°C");
  });
  it("singular when one year is missing", () => {
    expect(unknowns(doc, "es").join(" ")).not.toMatch(/~1 años/);
  });
});

describe("limits (doc v2 §3.1)", () => {
  it("fixed order: simulated first, scale always last", () => {
    const all = limitsFor({ flags: 32 | 128 | 1, verdict: 1, simulated: false, resolutionDeg: 0.5, nCells: 10 });
    expect(all.map((l) => l.key)).toEqual(["SIMULADO", "QUIEBRE_POSIBLE", "DEPENDE_DEL_METODO", "ESCALA"]);
  });
  it("the Arctic bias appears only for POWER/MERRA-2 cells above 66.5° N", () => {
    const k = (lat: number, ds: string) => limitsFor({ flags: 0, verdict: 1, simulated: false, resolutionDeg: 0.5, lat, datasetName: ds }).map((l) => l.key);
    expect(k(70, "NASA POWER (MERRA-2)")).toContain("ARTICO_MERRA2");
    expect(k(60, "NASA POWER (MERRA-2)")).not.toContain("ARTICO_MERRA2");
    expect(k(70, "GISTEMP v4")).not.toContain("ARTICO_MERRA2");
  });
  it("1 / 3 / all", () => {
    const all = limitsFor({ flags: 255, verdict: 0, simulated: true, resolutionDeg: 2 });
    expect(shownLimits(all, "sencillo")).toHaveLength(1);
    expect(shownLimits(all, "normal")).toHaveLength(3);
    expect(shownLimits(all, "tecnico")).toHaveLength(all.length);
  });
});

describe("since your last visit (doc v2 §5.2)", () => {
  it("seen ids are not announced again, and marking twice changes nothing", () => {
    const ids = doc.events.map((e) => e.id);
    expect(unseen(doc.events, [])).toHaveLength(ids.length);
    const seen = markSeen(markSeen([], ids), ids);
    expect(seen).toEqual(ids);
    expect(unseen(doc.events, seen)).toHaveLength(0);
  });
  it("a source that stopped publishing goes to «calidad», one that is on time does not", () => {
    expect(staleSources(doc, new Date("2026-11-15"), "es")).toHaveLength(0);
    expect(staleSources(doc, new Date("2027-06-01"), "es").length).toBe(monitors.length);
  });
});

describe("calibration shown = calibration measured", () => {
  it("the web's fallback numbers equal the ones ZON exports (MODEL_CARD §3.1, §3.9)", () => {
    expect(MEASURED.fdr_probado_real_null).toEqual(doc.calibration.fdr_probado_real_null);
    expect(MEASURED.fdr_ebh_real_null).toEqual(doc.calibration.fdr_ebh_real_null);
    expect(MEASURED.power_at_delta).toEqual(doc.calibration.power_at_delta);
  });
  it("Normal says «entre 6 y 24 de cada 100»; Simple carries no percentage", () => {
    expect(certaintyText("normal", "es")).toContain("entre 6 y 24 de cada 100");
    expect(certaintyText("sencillo", "es")).not.toMatch(/\d/);
  });
});

describe("levels by voice or text (doc v2 §2.5)", () => {
  const intent = (s: string) => parse(s, []).intent;
  it("steps, names, and the everyday word «normal»", () => {
    expect(intent("más detalle")).toEqual({ t: "register", r: "+" });
    expect(intent("más simple")).toEqual({ t: "register", r: "-" });
    expect(intent("modo normal")).toEqual({ t: "register", r: "normal" });
    expect(intent("modo experto")).toEqual({ t: "register", r: "tecnico" });
    expect(intent("simple")).toEqual({ t: "register", r: "sencillo" });
    expect(intent("¿es normal este calor?").t).not.toBe("register");
  });
  it("«¿qué tan seguro?» is the calibration; «¿cuánto falta para estar seguros?» is still detectability", () => {
    expect(intent("¿Qué tan seguro es?").t).toBe("certainty");
    expect(intent("how reliable is this?").t).toBe("certainty");
    expect(intent("¿Cuánto falta para estar seguros?").t).toBe("detect");
  });
  it("steps clamp and each level offers its own metrics", () => {
    expect(stepRegister("tecnico", 1)).toBe("tecnico");
    expect(stepRegister("sencillo", -1)).toBe("sencillo");
    expect(stepRegister("sencillo", 1)).toBe("normal");
    expect(effectiveMetric("sencillo", "effect")).toBe("verdict");
    expect(effectiveMetric("normal", "effect")).toBe("effect");
    expect(effectiveMetric("normal", "mde")).toBe("verdict");
    expect(effectiveMetric("tecnico", "years")).toBe("years");
  });
});
