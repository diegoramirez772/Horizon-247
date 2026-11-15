// The «modelador»: worlds the scene generator can build, each from REFERENCE facts (NASA Planetary / Moon Fact Sheets,
// NSSDCA; mission results named per world). The facts set what you see — how bright the Sun is (1/d², through the
// atmosphere), its size in the sky, the colour of the sky and ground, whether there are lakes, craters or ice, which giant
// planet hangs over the horizon — and the scene says, as always, that it is generated, not a photo (H5).
// Gas and ice giants have no solid surface to stand on: the modeler says so and offers their moons instead (no invention).

export type WorldId = "earth" | "mars" | "moon" | "mercury" | "venus" | "titan" | "europa" | "io" | "pluto";

export interface World {
  id: WorldId;
  name: { es: string; en: string };
  /** Words people use for it (normalised, no accents). */
  words: string[];
  facts: {
    gravity: number; // m/s²
    tempC: number; // mean surface temperature
    pressureBar: number; // surface pressure (0 = no real atmosphere)
    sunAu: number; // distance to the Sun (AU, mean)
    atmosphere: { es: string; en: string };
    source: string;
  };
  look: {
    soil: string; rock: string; relief: number; craters: number;
    /** Liquid on the surface: colour (Titan's methane–ethane seas). */
    liquid?: string;
    zenith: string; horizon: string;
    /** 0…1: how much light the atmosphere lets through to the ground (Venus ≈ 0.1, Titan ≈ 0.1 of what reaches the top). */
    transmit: number;
    fog: number;
    /** Giant planet in the sky (Jupiter seen from Europa and Io): direction and angular diameter in degrees. */
    giant?: { dir: [number, number, number]; deg: number; kind: "jupiter" | "earth" };
    /** Signature thing of the world, built from existing models (plumes, ice ridges…). */
    feature?: "plumas" | "crestas_hielo" | "lagos" | "llanura_nitrogeno";
  };
}

const NSSDCA = "NASA NSSDCA, Planetary Fact Sheet";

export const WORLDS: Record<WorldId, World> = {
  earth: { id: "earth", name: { es: "Tierra", en: "Earth" }, words: ["tierra", "earth"],
    facts: { gravity: 9.81, tempC: 15, pressureBar: 1.014, sunAu: 1, atmosphere: { es: "nitrógeno y oxígeno", en: "nitrogen and oxygen" }, source: NSSDCA },
    look: { soil: "#a68a64", rock: "#7d7062", relief: 1, craters: 0, zenith: "#3a78d0", horizon: "#b9d6f2", transmit: 1, fog: 0.002 } },
  mars: { id: "mars", name: { es: "Marte", en: "Mars" }, words: ["marte", "mars", "planeta rojo"],
    facts: { gravity: 3.71, tempC: -65, pressureBar: 0.006, sunAu: 1.52, atmosphere: { es: "dióxido de carbono, muy tenue, con polvo", en: "thin carbon dioxide with dust" }, source: NSSDCA },
    look: { soil: "#b5603a", rock: "#7d4229", relief: 2.6, craters: 3, zenith: "#b4895f", horizon: "#dcb68a", transmit: 0.8, fog: 0.004 } },
  moon: { id: "moon", name: { es: "Luna", en: "Moon" }, words: ["luna", "moon", "la luna"],
    facts: { gravity: 1.62, tempC: -20, pressureBar: 0, sunAu: 1, atmosphere: { es: "sin atmósfera", en: "no atmosphere" }, source: "NASA NSSDCA, Moon Fact Sheet" },
    look: { soil: "#9a9893", rock: "#6f6d69", relief: 2, craters: 7, zenith: "#000000", horizon: "#050508", transmit: 1, fog: 0,
      giant: { dir: [-0.66, 0.09, -0.75], deg: 2, kind: "earth" } } },
  mercury: { id: "mercury", name: { es: "Mercurio", en: "Mercury" }, words: ["mercurio", "mercury"],
    facts: { gravity: 3.7, tempC: 167, pressureBar: 0, sunAu: 0.39, atmosphere: { es: "exosfera, casi vacío", en: "exosphere, almost vacuum" }, source: `${NSSDCA}; MESSENGER` },
    look: { soil: "#8c8378", rock: "#5f5953", relief: 2.2, craters: 11, zenith: "#000000", horizon: "#040404", transmit: 1, fog: 0 } },
  venus: { id: "venus", name: { es: "Venus", en: "Venus" }, words: ["venus"],
    facts: { gravity: 8.87, tempC: 464, pressureBar: 92, sunAu: 0.72, atmosphere: { es: "dióxido de carbono espeso con nubes de ácido sulfúrico", en: "thick carbon dioxide with sulfuric acid clouds" }, source: `${NSSDCA}; Venera 13/14` },
    look: { soil: "#6b5642", rock: "#4f4033", relief: 1.2, craters: 1, zenith: "#a87a36", horizon: "#e0b064", transmit: 0.1, fog: 0.035 } },
  titan: { id: "titan", name: { es: "Titán", en: "Titan" }, words: ["titan", "luna de saturno"],
    facts: { gravity: 1.35, tempC: -179, pressureBar: 1.5, sunAu: 9.5, atmosphere: { es: "nitrógeno con neblina de hidrocarburos; lagos de metano y etano", en: "nitrogen with hydrocarbon haze; methane–ethane lakes" }, source: "NASA, Cassini–Huygens" },
    look: { soil: "#6b4f2a", rock: "#8a6a3e", relief: 1.4, craters: 0, liquid: "#2b2418", zenith: "#8a5a26", horizon: "#c08a46", transmit: 0.1, fog: 0.03, feature: "lagos" } },
  europa: { id: "europa", name: { es: "Europa", en: "Europa" }, words: ["europa", "luna de jupiter"],
    facts: { gravity: 1.31, tempC: -160, pressureBar: 0, sunAu: 5.2, atmosphere: { es: "sin atmósfera apreciable; corteza de hielo", en: "no appreciable atmosphere; ice crust" }, source: "NASA, Galileo / Europa Clipper" },
    look: { soil: "#d9d2c3", rock: "#9b5a3a", relief: 0.8, craters: 1, zenith: "#000000", horizon: "#05060a", transmit: 1, fog: 0,
      giant: { dir: [0.45, 0.32, -0.83], deg: 12, kind: "jupiter" }, feature: "crestas_hielo" } },
  io: { id: "io", name: { es: "Ío", en: "Io" }, words: ["io", "volcanes de jupiter"],
    facts: { gravity: 1.8, tempC: -143, pressureBar: 0, sunAu: 5.2, atmosphere: { es: "dióxido de azufre muy tenue; cientos de volcanes activos", en: "very thin sulfur dioxide; hundreds of active volcanoes" }, source: "NASA, Galileo / Juno" },
    look: { soil: "#d8c25a", rock: "#a8642a", relief: 1.8, craters: 0, zenith: "#000000", horizon: "#07060a", transmit: 1, fog: 0,
      giant: { dir: [-0.5, 0.36, -0.79], deg: 19, kind: "jupiter" }, feature: "plumas" } },
  pluto: { id: "pluto", name: { es: "Plutón", en: "Pluto" }, words: ["pluton", "pluto"],
    facts: { gravity: 0.62, tempC: -229, pressureBar: 0.00001, sunAu: 39.5, atmosphere: { es: "nitrógeno muy tenue con neblina azul; llanuras de hielo de nitrógeno", en: "very thin nitrogen with blue haze; nitrogen-ice plains" }, source: "NASA, New Horizons" },
    look: { soil: "#e8dccb", rock: "#a0603a", relief: 1.6, craters: 2, zenith: "#000000", horizon: "#1a2a44", transmit: 1, fog: 0.002, feature: "llanura_nitrogeno" } },
};

/** Worlds without a surface to stand on: what to say instead of inventing one. */
export const NO_SURFACE: Record<string, { es: string; en: string; moons: WorldId[] }> = {
  jupiter: { es: "Júpiter es un gigante de gas: no tiene superficie sólida donde pararse. Puedo mostrar sus lunas Europa o Ío.", en: "Jupiter is a gas giant: there is no solid surface to stand on. I can show its moons Europa or Io.", moons: ["europa", "io"] },
  saturno: { es: "Saturno es un gigante de gas: no tiene superficie sólida. Puedo mostrar su luna Titán.", en: "Saturn is a gas giant: no solid surface. I can show its moon Titan.", moons: ["titan"] },
  urano: { es: "Urano es un gigante de hielo sin superficie sólida a la vista: la escena sería inventada.", en: "Uranus is an ice giant with no visible solid surface: the scene would be invented.", moons: [] },
  neptuno: { es: "Neptuno es un gigante de hielo sin superficie sólida a la vista: la escena sería inventada.", en: "Neptune is an ice giant with no visible solid surface: the scene would be invented.", moons: [] },
  sol: { es: "El Sol no tiene superficie donde pararse.", en: "The Sun has no surface to stand on.", moons: [] },
};

function norm(t: string): string {
  return t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** «llévame a Venus», «otro planeta: Titán» → the world (or a no-surface answer). Earth is never matched by «tierra» alone
 *  here (it is the default and also means soil). */
export function worldIn(text: string): { world: World } | { noSurface: (typeof NO_SURFACE)[string]; id: string } | null {
  const t = ` ${norm(text).replace(/[^a-z0-9 ]/g, " ")} `;
  for (const [id, v] of Object.entries(NO_SURFACE)) if (t.includes(` ${id} `) || t.includes(` ${id === "saturno" ? "saturn" : id === "urano" ? "uranus" : id === "neptuno" ? "neptune" : id} `)) return { noSurface: v, id };
  for (const w of Object.values(WORLDS)) {
    if (w.id === "earth") continue;
    if (w.words.some((x) => t.includes(` ${x} `))) return { world: w };
  }
  return null;
}

/** Sunlight at the ground relative to the Earth's: 1/d² through the atmosphere's transmission. */
export function sunlight(w: World): number {
  return w.look.transmit / (w.facts.sunAu * w.facts.sunAu);
}

/**
 * Cosine of the Sun's drawn radius from the world. The scenes draw the Earth's Sun ~7× its real size (1.98°, so it reads
 * on a small screen); every world keeps that same factor, so the RATIO is real: ×2.6 from Mercury, ÷40 from Pluto.
 */
export function sunCos(w: World): number {
  const deg = 1.98 / w.facts.sunAu;
  return Math.cos((Math.max(deg, 0.02) * Math.PI) / 180);
}

/** The ready-made scene of each world (presets.ts). */
export const WORLD_PRESET: Record<WorldId, string> = {
  earth: "rancho", mars: "marte", moon: "luna", mercury: "mercurio", venus: "venus", titan: "titan", europa: "europa", io: "io", pluto: "pluton",
};

/** Asked for a world in words: the preset to open, and — for a giant without surface — what to say and which moon instead. */
export function worldRequest(text: string): { preset: string; from?: string; say?: { es: string; en: string } } | null {
  const w = worldIn(text);
  if (!w) return null;
  if ("world" in w) return { preset: WORLD_PRESET[w.world.id] };
  const moon = w.noSurface.moons[0];
  return moon ? { preset: WORLD_PRESET[moon], from: w.id, say: w.noSurface } : { preset: "", from: w.id, say: w.noSurface };
}
