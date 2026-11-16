import { beforeAll, describe, expect, it } from "vitest";
import { type Municipio, findMunicipio, inRing, indexMunicipios } from "@/core/genui/municipios";
import { parse } from "@/core/assistant/parse";

const m = (cvegeo: string, name: string, ent: string, state: string, pop: number): Municipio =>
  ({ cvegeo, name, ent, state, pop, lat: 20, lon: -100, box: [-100.2, 19.8, -99.8, 20.2] });

beforeAll(() => indexMunicipios([
  m("10012", "Lerdo", "10", "Durango", 163313),
  m("10007", "Gómez Palacio", "10", "Durango", 372750),
  m("10005", "Durango", "10", "Durango", 688697),
  m("23005", "Benito Juárez", "23", "Quintana Roo", 911503),
  m("09014", "Benito Juárez", "09", "Ciudad de México", 434153),
  m("19006", "Benito Juárez", "19", "Nuevo León", 333000),
  m("31059", "Progreso", "31", "Yucatán", 66000),
  m("19049", "Santiago", "19", "Nuevo León", 46784),
  m("11003", "San Miguel de Allende", "11", "Guanajuato", 174615),
  m("08037", "Juárez", "08", "Chihuahua", 1512450),
  m("11020", "León", "11", "Guanajuato", 1721215),
]));

describe("municipios (INEGI)", () => {
  it("un nombre único se encuentra solo", () => {
    expect(findMunicipio("¿qué pasa en Gómez Palacio?")?.hit?.cvegeo).toBe("10007");
    expect(findMunicipio("San Miguel de Allende")?.hit?.cvegeo).toBe("11003");
  });
  it("el estado desempata y un nombre de estado solo sigue siendo el estado", () => {
    expect(findMunicipio("Lerdo, Durango")?.hit?.cvegeo).toBe("10012");
    expect(findMunicipio("Durango")).toBeNull();
    expect(findMunicipio("Durango, Durango")?.hit?.cvegeo).toBe("10005");
  });
  it("un nombre repetido da opciones, la más poblada primero; con estado, una sola", () => {
    const r = findMunicipio("alertas en Benito Juárez");
    expect(r?.hit).toBeNull();
    expect(r?.options.map((x) => x.ent)).toEqual(["23", "09", "19"]);
    expect(findMunicipio("Benito Juárez Quintana Roo")?.hit?.cvegeo).toBe("23005");
  });
  it("palabras comunes solo cuentan con su estado; los alias funcionan", () => {
    expect(findMunicipio("el progreso de la temperatura")).toBeNull();
    expect(findMunicipio("Progreso, Yucatán")?.hit?.cvegeo).toBe("31059");
    expect(findMunicipio("clima en Ciudad Juárez")?.hit?.cvegeo).toBe("08037");
    expect(findMunicipio("¿qué pasa en Nuevo León?")).toBeNull();
    expect(findMunicipio("León, Guanajuato")?.hit?.cvegeo).toBe("11020");
  });
  it("en el asistente: municipio con su recuadro, opciones si se repite, Santiago de Chile no es Nuevo León", () => {
    const a = parse("Lerdo, Durango", []);
    expect(a.intent.t).toBe("area");
    expect(a.where?.box).toBeDefined();
    expect(a.where?.inegi?.cvegeo).toBe("10012");
    const b = parse("alertas en Benito Juárez", []);
    expect(b.intent.t).toBe("pickPlace");
    if (b.intent.t === "pickPlace") expect(b.intent.then.t).toBe("topic");
    expect(parse("clima en Santiago de Chile", []).where?.name).toBe("Santiago de Chile");
  });
  it("un punto dentro o fuera de un contorno (también en forma de L)", () => {
    const L: [number, number][] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [0, 0]];
    expect(inRing(0.5, 3, L)).toBe(true);
    expect(inRing(3, 0.5, L)).toBe(true);
    expect(inRing(3, 3, L)).toBe(false);
    expect(inRing(-1, 1, L)).toBe(false);
  });
  it("«mundo» no es «undo»: la pregunta por el mundo llega a los eventos", () => {
    expect(parse("¿qué está pasando en el mundo?", []).intent.t).toBe("topic");
    expect(parse("undo", []).intent.t).toBe("undo");
  });
  it("espacio: asteroides y auroras sí; «datos meteorológicos» no", () => {
    expect(parse("¿qué asteroides pasan cerca?", []).intent).toMatchObject({ t: "topic", topic: "espacio" });
    expect(parse("¿hay auroras hoy?", []).intent).toMatchObject({ t: "topic", topic: "espacio" });
    expect(parse("datos meteorológicos de Durango", []).intent).not.toMatchObject({ topic: "espacio" });
  });
});
