// Golden cases of the assistant (doc 04 §5): question → expected intent and place. Must be 100 %.
import { describe, expect, it } from "vitest";
import type { Manifest, Region } from "@/contract/types";
import { compose, type CardKind, type Ctx } from "@/core/assistant/compose";
import { Conversation } from "@/core/assistant/conversation";
import { parse } from "@/core/assistant/parse";
import { run } from "@/core/assistant/run";
import type { IndexEntry } from "@/core/contract/extra";
import type { Layer } from "@/core/contract/loader";
import { FORBIDDEN } from "@/core/i18n/texts";
import { DEFAULT_STATE, Store } from "@/core/state/store";

const regions: Region[] = [{
  id: "mx-dgo", name: { es: "Durango (simulado)", en: "Durango (simulated)" },
  layers: {
    L24: { n_cells: 4, flags: 40, series: [1, 2, 3], effect: 0.31, ci: [0.22, 0.4], pCons: 0.2, qRegions: 0.2, verdict: 3, mde: 0.8, yearsMore: 12, emergenceYear: null },
    L45: { n_cells: 4, flags: 40, series: [1, 2, 3], effect: 0.27, ci: [0.2, 0.34], pCons: 0.001, qRegions: 0.001, verdict: 1, mde: 0.12, yearsMore: null, emergenceYear: 2019 },
  },
}];

const GOLDEN: [string, string, string | null][] = [
  // clear
  ["¿qué cambió en Durango?", "area", "mx-dgo"],
  ["durango", "area", "mx-dgo"],
  ["What changed in Durango?", "area", "mx-dgo"],
  ["resumen", "summary", null],
  ["¿qué está cambiando?", "summary", null],
  ["muéstrame 24 años", "window", null],
  ["45 years", "window", null],
  ["compara 24 y 45 años", "compare", null],
  ["evidencia acumulada hasta 1999", "accumulated", null],
  ["año a año 2010", "year", null],
  // typos and synonyms
  ["que cambio en durnago", "summary", null],
  ["cuanto falta para estar seguros", "detect", null],
  ["¿Cuánto falta en Durango?", "detect", "mx-dgo"],
  ["how long until we can be sure", "detect", null],
  ["qué significa el rayado", "legend", null],
  ["what do the stripes mean", "legend", null],
  ["de donde salen los datos", "provenance", null],
  ["source of the data", "provenance", null],
  // commands
  ["modo experto", "register", null],
  ["más sencillo", "register", null],
  ["en inglés", "lang", null],
  ["spanish please", "lang", null],
  ["modo oscuro", "theme", null],
  ["24.0, -104.7", "area", "coord"],
  ["24 n 104.7 o", "area", "coord"],
  // limits (H16, H17)
  ["¿qué debo hacer con mi cultivo?", "advice", null],
  ["recomiéndame algo", "advice", null],
  ["what should I do", "advice", null],
  ["¿por qué sube?", "cause", null],
  ["¿cuál es la causa?", "cause", null],
  ["why is it rising", "cause", null],
  // help, correction, profiles
  ["¿qué puedes hacer?", "help", null],
  ["ayuda", "help", null],
  ["no era eso", "undo", null],
  ["marte", "topic", null],
  // Generative interface (Plan de unión U3) and Monitoreo (U5, U6)
  ["¿cómo están las vacas en Torreón?", "topic", null],
  ["monitoreo de astronautas", "topic", null],
  ["¿qué incendios hay ahora?", "topic", null],
  ["los planetas del sistema solar", "topic", null],
  ["¿qué clima hace hoy en Durango?", "topic", "mx-dgo"],
  ["muéstrame el infrarrojo", "imagery", null],
  ["la evolución de la Tierra", "evolution", null],
  ["contraste ingenuo", "contrast", null],
  // not understood
  ["gráfica bonita", "unknown", null],
  ["asdf qwer", "unknown", null],
  ["", "unknown", null],
  ["hola", "greet", null],
];

describe("golden questions (doc 04 §5)", () => {
  it.each(GOLDEN)("«%s» → %s", (q, intent, place) => {
    const c = parse(q, regions);
    expect(c.intent.t).toBe(intent);
    if (place === "coord") expect(c.place?.kind).toBe("coord");
    else if (place) expect(c.place).toEqual({ kind: "region", id: place });
  });
  it("has at least 40 cases", () => expect(GOLDEN.length).toBeGreaterThanOrEqual(40));
});

// ---- a tiny fake layer: 1 × 2 grid, values that we can recognise in the text ----
function fakeLayer(id: string, n: number): Layer {
  const manifest = {
    contract: "0.2", id, profile: "earth", title: { es: `Temperatura · ${n} años`, en: `Temperature · ${n} years` },
    variable: { name: "temp", unit: "°C", unit_per_decade: "°C/década" },
    grid: { nlat: 1, nlon: 2, lat0: 0, dlat: -1, lon0: 0, dlon: 1, native_resolution_deg: 1 },
    window: { start: 2025 - n, end: 2024, n, step: "annual" }, params: { alpha: 0.05, fdr_q: 0.1, delta_sigma_per_decade: 2 },
    methods: ["MK-VC", "TFPW-WS", "OLS-AR1"], arrays: {}, summary: { probado: 1, no_concluyente: 1, naive_marked: 2, cells_valid: 2 },
    dataset: { name: "GISTEMP", provider: "NASA GISS", url: "", version: "v4", licence: "public", kind: "real", sha256: "" },
    honesty: { data_real: true, simulated: false, label_es: "Datos reales", label_en: "Real data" }, warnings: [],
  } as unknown as Manifest;
  return {
    basePath: "", manifest, cells: 2, series: null,
    arrays: {
      effect: new Float32Array([0.123, -0.456]), ci_lo: new Float32Array([0.1, -0.5]), ci_hi: new Float32Array([0.2, -0.4]),
      sigma: new Float32Array([0.5, 0.5]), r1: new Float32Array([0.1, 0.1]), p_cons: new Float32Array([0.001, 0.3]),
      q_cons: new Float32Array([0.01, 0.5]), mde: new Float32Array([0.05, 0.9]), years_more: new Float32Array([NaN, 14]),
      verdict: new Uint8Array([1, 3]), flags: new Uint8Array([0, 0]), nvalid: new Uint8Array([n, n]),
      nsig_methods: new Uint8Array([3, 0]), naive_sig: new Uint8Array([1, 0]),
    },
  };
}
const entries: IndexEntry[] = [
  { id: "L24", profile: "earth", title: { es: "T 24", en: "T 24" }, variable: "temp", window: { start: 2001, end: 2024, n: 24 }, path: "a/" },
  { id: "L45", profile: "earth", title: { es: "T 45", en: "T 45" }, variable: "temp", window: { start: 1980, end: 2024, n: 45 }, path: "b/" },
];

const KINDS: CardKind[] = ["greet", "area", "summary", "detect", "compare", "contrast", "legend", "provenance", "help", "advice", "cause",
  "unknown1", "unknown2", "unknown3", "noSelection", "year", "accumulated", "undo", "profile", "noWindow", "done"];

describe("answer cards", () => {
  const layer = fakeLayer("L24", 24);
  const ctx = (sel: Ctx["state"]["selection"]): Ctx => ({ layer, regions, entries, state: { ...DEFAULT_STATE, layerId: "L24", selection: sel, year: 2010 } });

  it("no card, in any language or register, uses a forbidden word (doc 04 §4)", () => {
    for (const sel of [null, { kind: "cell" as const, index: 0 }, { kind: "region" as const, id: "mx-dgo" }]) {
      for (const k of KINDS) {
        const c = compose(k, ctx(sel), "user");
        for (const lang of ["es", "en"] as const) for (const reg of ["sencillo", "tecnico"] as const) {
          for (const re of FORBIDDEN) expect(c.text[lang][reg], `${k}/${lang}/${reg}`).not.toMatch(re);
          expect(c.text[lang][reg]).not.toMatch(/[{}]|undefined|NaN/);
        }
        expect(c.chips.length).toBeLessThanOrEqual(6);
      }
    }
  });

  it("numbers come from the bundle: the expert sentence carries the cell's effect and interval", () => {
    const c = compose("area", ctx({ kind: "cell", index: 0 }), "user");
    expect(c.text.es.tecnico).toContain("+0.12");
    expect(c.text.es.tecnico).toContain("+0.10 a +0.20");
    expect(c.text.es.sencillo).toContain("sube: apenas 0,12 °C cada diez años");
    expect(c.origin).toBe("hori");
    expect(c.evidence).toEqual({ layerId: "L24", selection: { kind: "cell", index: 0 } });
  });

  it("«compara» reads both windows of the region from regions.json", () => {
    const c = compose("compare", ctx({ kind: "region", id: "mx-dgo" }), "user");
    // Sencillo uses everyday words; Experto the contract's openings.
    expect(c.text.es.sencillo).toContain("Con 24 años: aún no se sabe.");
    expect(c.text.es.sencillo).toContain("Con 45 años: ya cambió.");
    expect(c.text.es.tecnico).toContain("Con 24 años: aún no se puede saber.");
    expect(c.text.es.tecnico).toContain("Con 45 años: cambio detectado.");
  });

  it("not understood three times → shows the menu and stops insisting", () => {
    const store = new Store({ ...DEFAULT_STATE, layerId: "L24", hydrated: true });
    const conv = new Conversation();
    const deps = { store, conv, ctx: () => ({ layer, regions, entries, state: store.get() }), setTheme: () => {} };
    for (let k = 0; k < 4; k++) run(parse("blablá", regions), "text", "blablá", deps);
    const kinds = conv.get().messages.filter((m) => m.role === "assistant").map((m) => (m.role === "assistant" ? m.card.kind : ""));
    expect(kinds).toEqual(["unknown1", "unknown2", "unknown3", "unknown3"]);
  });

  it("«no era eso» puts the view back as it was", () => {
    const store = new Store({ ...DEFAULT_STATE, layerId: "L24", hydrated: true });
    const conv = new Conversation();
    const deps = { store, conv, ctx: () => ({ layer, regions, entries, state: store.get() }), setTheme: () => {} };
    run(parse("¿qué cambió en Durango?", regions), "text", "x", deps);
    expect(store.get().selection).toEqual({ kind: "region", id: "mx-dgo" });
    run(parse("no era eso", regions), "chip", "No era eso", deps);
    expect(store.get().selection).toBeNull();
  });

  it("switching window waits for the new layer before answering", () => {
    const store = new Store({ ...DEFAULT_STATE, layerId: "L24", hydrated: true, selection: { kind: "region", id: "mx-dgo" } });
    const conv = new Conversation();
    const deps = { store, conv, ctx: () => ({ layer, regions, entries, state: store.get() }), setTheme: () => {} };
    run(parse("45 años", regions), "text", "45 años", deps);
    expect(store.get().layerId).toBe("L45");
    expect(conv.pending).toMatchObject({ waitLayer: "L45", kind: "area" });
  });
});
