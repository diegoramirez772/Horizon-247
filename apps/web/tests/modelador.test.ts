import { describe, expect, it } from "vitest";
import { parse } from "@/core/assistant/parse";
import { spokenToDigits } from "@/core/interaction/numbers";
import { normalize } from "@/core/assistant/patterns";
import { compose } from "@/core/scene/compose";
import { PRESETS, preset } from "@/core/scene/presets";
import { sceneCommand } from "@/core/scene/voice";
import { WORLDS, sunlight, worldRequest } from "@/core/scene/worlds";

const say = (t: string) => spokenToDigits(normalize(t));

describe("the modeler: other worlds from reference facts", () => {
  it("every world has a scene that builds, labelled generated, with its facts and source", () => {
    for (const id of ["mercurio", "venus", "titan", "europa", "io", "pluton", "marte", "luna"]) {
      const sc = compose(preset(id));
      expect(sc.vertices, id).toBeGreaterThan(1000);
      expect(sc.banner).toMatch(/no es una foto/);
      if (!["marte", "luna"].includes(id)) expect(sc.elements.find((e) => e.id === "mundo")?.rule, id).toMatch(/Fuente: NASA/);
    }
  });

  it("the facts drive the look: Venus and Titan hide the Sun in haze, Mercury's Sun is bigger, Jupiter fills Io's sky", () => {
    const venus = compose(preset("venus")).sky, merc = compose(preset("mercurio")).sky, io = compose(preset("io")).sky, titan = compose(preset("titan"));
    expect(venus.sunSize).toBeGreaterThan(1); // no disc
    expect(merc.sunSize).toBeLessThan(compose(preset("luna")).sky.sunSize); // larger disc than from 1 AU
    expect(io.earthDir).not.toBeNull();
    expect(io.giant?.kind).toBe(1);
    expect(titan.elements.some((e) => e.id === "agua" && /metano/.test(e.label))).toBe(true);
    expect(sunlight(WORLDS.titan)).toBeLessThan(0.01);
    expect(merc.stars).toBe(1);
  });

  it("asked in words: a world opens; a giant says it has no surface and shows its moon", () => {
    expect(worldRequest("llevame a venus")?.preset).toBe("venus");
    expect(worldRequest("muestrame jupiter")).toMatchObject({ preset: "europa", from: "jupiter" });
    expect(worldRequest("y neptuno")?.preset).toBe("");
    const ids = PRESETS.map((p) => ({ id: p.id, label: p.label }));
    const spec = preset("rancho");
    expect(sceneCommand(say("llévame a Titán"), spec, [], ids)?.presetId).toBe("titan");
    const j = sceneCommand(say("quiero ver Júpiter"), spec, [], ids);
    expect(j?.presetId).toBe("europa");
    expect(j?.say.es).toMatch(/no tiene superficie/);
    const c = parse("llévame a Venus", []);
    expect(c.intent).toMatchObject({ t: "scene", preset: "venus" });
    expect(parse("genera Saturno en 3D", []).intent).toMatchObject({ t: "scene", preset: "titan", from: "saturno" });
  });
});
