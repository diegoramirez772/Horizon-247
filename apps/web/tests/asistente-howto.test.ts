import { describe, expect, it } from "vitest";
import { parse } from "@/core/assistant/parse";
import { compose, type Ctx } from "@/core/assistant/compose";
import { howtoAnswer, type HowKey } from "@/core/assistant/howto";
import { DEFAULT_STATE } from "@/core/state/store";

const intent = (t: string) => parse(t, []).intent;
const FORBIDDEN = /prueba|causa|predic|recomend|debería|peligro|diagnós|riesgo|urgente|no hay cambio(?![^"]*δ)/i;

describe("the assistant explains how to use the product, and acts", () => {
  it.each([
    ["bro los gestos se jodieron, no puedo dar clic", "gestos_clic"],
    ["¿cómo doy clic con la mano?", "gestos_clic"],
    ["el puntero se vuelve loco con los gestos", "gestos_loco"],
    ["¿qué gestos hay?", "gestos"],
    ["¿cómo funciona la detección?", "deteccion"],
    ["¿qué es lo significativo?", "focos"],
    ["¿qué es un foco?", "focos"],
    ["¿qué es el recorrido de focos?", "focos"],
    ["¿qué significa aún no se sabe?", "no_se_sabe"],
    ["no entiendo qué es la zona en 3D", "zona3d"],
    ["¿cómo veo el cambio en tiempo real?", "cambio_tiempo"],
    ["¿cómo funcionan las señales de fauna?", "fauna"],
    ["¿cómo me avisas de las alertas?", "alertas"],
    ["¿qué es lo de persona?", "persona"],
    ["¿qué planetas puedo ver?", "planetas"],
    ["¿cómo uso la voz?", "voz"],
  ])("«%s» → %s", (text, key) => {
    expect(intent(text)).toEqual({ t: "howto", key });
  });

  it("acts on direct requests", () => {
    expect(intent("la línea de tiempo va a madres")).toEqual({ t: "speed", v: "-" });
    expect(intent("más lento")).toEqual({ t: "speed", v: "-" });
    expect(intent("velocidad normal")).toEqual({ t: "speed", v: 1 });
    expect(intent("habla más lento")).not.toMatchObject({ t: "speed" }); // the voice's speech rate, not the timeline
    expect(intent("enciende los gestos")).toEqual({ t: "gestures", on: true });
    expect(intent("apaga gestos")).toEqual({ t: "gestures", on: false });
    expect(intent("abre las señales de fauna")).toEqual({ t: "open", panel: "fauna" });
    expect(intent("muéstrame los focos")).toEqual({ t: "open", panel: "map", tour: "apoyado" });
    expect(intent("llévame a Venus")).toMatchObject({ t: "scene", preset: "venus" });
  });

  it("does not steal what other answers already handle", () => {
    expect(intent("¿qué significa cada color?").t).toBe("legend");
    expect(intent("¿qué tan seguro es?").t).toBe("certainty");
    expect(intent("¿qué puedes hacer?").t).toBe("help");
  });

  it("every answer is plain, honest and offers an action", () => {
    const ctx = { layer: null, regions: [], entries: [], state: { ...DEFAULT_STATE, hydrated: true } } as unknown as Ctx;
    const keys: HowKey[] = ["gestos_clic", "gestos_loco", "gestos", "velocidad", "deteccion", "focos", "no_se_sabe", "zona3d", "cambio_tiempo", "fauna", "alertas", "persona", "planetas", "voz"];
    for (const k of keys) {
      const a = howtoAnswer(k);
      expect(a.chips.length, k).toBeGreaterThan(0);
      expect(`${a.text.es} ${a.text.en}`, k).not.toMatch(FORBIDDEN);
      const card = compose(`howto:${k}`, ctx, "user");
      expect(card.text.es.sencillo).toBe(a.text.es);
    }
    expect(compose("speed", { ...ctx, state: { ...ctx.state, speed: 0.5 } }, "user").text.es.sencillo).toMatch(/×0[.,]5/);
  });
});
