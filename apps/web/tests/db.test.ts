import { describe, expect, it } from "vitest";
import { visibleContext } from "@/core/contract/loader";
import { cardFromRow } from "@/core/live/db";

describe("team database (publishable key)", () => {
  it("maps a context_cards row to the contract card and keeps the visibility rule", () => {
    const row = {
      id: "ctx-001", region: "mx-dgo", level: "ASOCIACION" as const, text_es: "Hola", text_en: "Hi",
      source_title: "CONAGUA", source_url: "https://smn.conagua.gob.mx", source_year: 2024, status: "revisado" as const,
    };
    const c = cardFromRow(row);
    expect(c).toEqual({ id: "ctx-001", region: "mx-dgo", level: "ASOCIACION", text: { es: "Hola", en: "Hi" },
      source: { title: "CONAGUA", url: "https://smn.conagua.gob.mx", year: 2024 }, status: "revisado" });
    expect(visibleContext([c, cardFromRow({ ...row, id: "b", source_url: null }), cardFromRow({ ...row, id: "c", status: "borrador" })]).map((x) => x.id)).toEqual(["ctx-001"]);
  });
});
