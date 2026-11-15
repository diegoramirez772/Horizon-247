// «Lo que veo en mi lugar», dicho con palabras normales, abre el borrador de reporte de la red enjambre.
// Las preguntas siguen yendo a HORI.
import { describe, expect, it } from "vitest";
import { parse } from "@/core/assistant/parse";

const kind = (s: string) => parse(s, []).intent.t;

describe("observaciones en lenguaje natural → reporte", () => {
  it.each([
    "el rio por mi casa se esta secando",
    "El río por mi casa se está secando",
    "hay humo en mi pueblo",
    "no ha llovido en mi rancho",
    "se murieron los peces en la presa",
    "el arroyo cerca de mi casa ya no corre",
    "cayó granizo en mi colonia",
    "the river near my house is drying up",
  ])("«%s» es un reporte", (s) => expect(kind(s)).toBe("report"));

  it.each([
    "¿se está secando el río?",
    "por qué se está secando el río",
    "¿está subiendo la temperatura en Durango?",
    "lluvia en Durango",
    "qué pasa con la sequía en Chihuahua",
    "is the river drying up?",
  ])("«%s» no es un reporte", (s) => expect(kind(s)).not.toBe("report"));

  it("conserva el texto completo como borrador", () => {
    const i = parse("el rio por mi casa se esta secando", []).intent;
    expect(i.t === "report" && i.text).toBe("El rio por mi casa se esta secando");
  });
});
