// Voice control of the generated scene: every object is driven by readings or is an entity (doc «Interacción v2» §2.6).

import { describe, expect, it } from "vitest";
import { normalize } from "@/core/assistant/patterns";
import { spokenToDigits } from "@/core/interaction/numbers";
import { compose } from "@/core/scene/compose";
import { PRESETS, preset } from "@/core/scene/presets";
import { sceneCommand } from "@/core/scene/voice";

const P = PRESETS.map((p) => ({ id: p.id, label: p.label }));
const say = (text: string, id = "rancho") => {
  const spec = preset(id);
  return { spec, r: sceneCommand(spokenToDigits(normalize(text)), spec, compose(spec).elements, P) };
};

describe("scene by voice", () => {
  it("changes a reading and marks it simulated", () => {
    const { spec, r } = say("más lluvia");
    expect(r?.spec?.vars.precip_mm_h?.value).toBeGreaterThan(spec.vars.precip_mm_h?.value ?? 0);
    expect(r?.spec?.vars.precip_mm_h?.kind).toBe("simulada");
    expect(r?.say.es).toContain("simulado");
  });
  it("sets a value said in words, clamped to the slider range", () => {
    expect(say("temperatura a treinta y ocho").r?.spec?.vars.temp_c?.value).toBe(38);
    expect(say("temperatura a 90").r?.spec?.vars.temp_c?.value).toBe(48);
    expect(say("nubes al 80").r?.spec?.vars.cloud_frac?.value).toBe(0.8);
  });
  it("turns things off and to the maximum", () => {
    expect(say("apaga el fuego", "incendio").r?.spec?.vars.fire_frp_mw?.value).toBe(0);
    expect(say("viento al máximo").r?.spec?.vars.wind_ms?.value).toBe(30);
  });
  it("«más sequía» lowers the drought index", () => {
    const { spec, r } = say("más sequía");
    expect(r?.spec?.vars.spi?.value).toBeLessThan(spec.vars.spi?.value ?? 0);
  });
  it("time of day", () => {
    expect(say("hazlo de noche").r?.spec?.vars.hour?.value).toBe(22);
  });
  it("adds and removes entities", () => {
    const cows = (s: ReturnType<typeof preset>) => s.entities.find((e) => e.kind === "ganado" && e.species === "vaca");
    const { spec, r } = say("agrega cinco vacas");
    expect((cows(r!.spec!) as { count: number }).count).toBe((cows(spec) as { count: number }).count + 5);
    expect(say("quita el molino").r?.spec?.entities.some((e) => e.kind === "dispositivo" && e.type === "molino")).toBe(false);
    expect(say("pon un dron").r?.spec?.entities.some((e) => e.kind === "dispositivo" && e.type === "dron")).toBe(true);
  });
  it("explains an object from its readings", () => {
    const { r } = say("¿qué mueve el pasto?");
    expect(r?.focus).toBe("pasto");
    expect(r?.say.es).toContain("NDVI");
    expect(r?.spec).toBe(undefined);
  });
  it("switches situation", () => {
    expect(say("muestra la sequía").r?.presetId).toBe("sequia");
    expect(say("marte").r?.presetId).toBe("marte");
  });
  it("leaves other speech alone", () => {
    expect(say("¿qué cambió en Durango?").r).toBe(null);
    expect(say("muestra números").r).toBe(null);
  });
  it("every changed scene still composes", () => {
    for (const t of ["más lluvia", "agrega 30 vacas", "apaga el fuego", "nieve al 100", "de noche"]) {
      const r = say(t).r!;
      if (r.spec) expect(compose(r.spec).solid.every(Number.isFinite)).toBe(true);
    }
  });
});
