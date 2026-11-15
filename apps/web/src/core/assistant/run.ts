// Executes one command: changes what is on screen (the "action") and leaves one card (doc 01 §4).
// The map and the controls never depend on this: if the assistant misunderstands, the room still works (doc 01 §1).

import { entryWindow, siblings } from "@/core/contract/extra";
import { cellIndexAt } from "@/core/contract/loader";
import { stepRegister, type AppState, type Store } from "@/core/state/store";
import { compose, topicCard, type CardKind, type Ctx, type Source } from "./compose";
import type { Conversation, Via } from "./conversation";
import type { Command } from "./parse";

export interface Deps {
  store: Store;
  conv: Conversation;
  /** Current context (layer on screen, regions, index) — read at call time. */
  ctx: () => Ctx;
  setTheme: (t: "light" | "dark") => void;
}

/** Shows `kind` now, or as soon as layer `layerId` is on screen. */
function answerWhenReady(d: Deps, kind: CardKind, source: Source, correctable: boolean, layerId: string | null): void {
  const ctx = d.ctx();
  if (!layerId || ctx.layer?.manifest.id === layerId) {
    d.conv.pending = null;
    d.conv.answer(compose(kind, { ...ctx, state: d.store.get() }, source, { correctable }));
  } else {
    d.conv.pending = { kind, source, correctable, waitLayer: layerId };
  }
}

export function run(cmd: Command, via: Via, label: string | null, d: Deps): void {
  const { store, conv } = d;
  const ctx = d.ctx();
  const source: Source = "user";
  if (label !== null) conv.say(label, via);
  if (via === "voice") conv.setVoiceReply(true);

  const i = cmd.intent;
  if (i.t === "unknown") {
    conv.unknownStreak = Math.min(3, conv.unknownStreak + 1);
    answerWhenReady(d, (`unknown${conv.unknownStreak}`) as CardKind, source, false, null);
    return;
  }
  conv.unknownStreak = 0;

  if (i.t === "undo") {
    const prev = conv.undo.pop();
    if (prev) store.set(prev);
    answerWhenReady(d, "undo", source, false, null);
    return;
  }
  if (i.t === "clear") {
    conv.clear();
    answerWhenReady(d, store.get().selection ? "area" : "summary", "system", false, null);
    return;
  }

  // Everything below may change the view: remember where we were, for «No era eso».
  const before = store.get();
  conv.undo.push(before);
  if (conv.undo.length > 20) conv.undo.shift();
  // Every command may point somewhere: the map flies to what the answer talks about.
  const patch: Partial<AppState> = { camera: before.camera + 1 };
  const correctable = true;

  // 1) A place mentioned in the command is looked at first («¿cuánto falta en Durango?»).
  if (cmd.place?.kind === "region") patch.selection = { kind: "region", id: cmd.place.id };
  if (cmd.place?.kind === "coord" && ctx.layer) {
    const idx = cellIndexAt(ctx.layer.manifest, cmd.place.lat, cmd.place.lon);
    if (idx >= 0) patch.selection = { kind: "cell", index: idx };
  }

  const entry = ctx.entries.find((e) => e.id === before.layerId) ?? null;
  const sibs = siblings(ctx.entries, entry);
  const m = ctx.layer?.manifest;

  switch (i.t) {
    case "lang": store.set({ ...patch, lang: i.l }); answerWhenReady(d, "done", source, false, null); return;
    case "register": {
      // Same numbers, another reading: nothing is recomputed and nothing is fetched (doc v2 §2.4).
      const r = i.r === "+" ? stepRegister(before.register, 1) : i.r === "-" ? stepRegister(before.register, -1) : i.r;
      store.set({ ...patch, register: r });
      answerWhenReady(d, before.selection || patch.selection ? "area" : "level", source, false, null);
      return;
    }
    case "certainty": store.set(patch); answerWhenReady(d, "certainty", source, correctable, null); return;
    case "theme": d.setTheme(i.th); store.set(patch); answerWhenReady(d, "done", source, false, null); return;
    case "profile":
      store.set(patch);
      answerWhenReady(d, i.p === "earth" ? "summary" : "profile", source, correctable, null);
      return;
    case "window": {
      const target = sibs.find((e) => entryWindow(e)!.n === i.n)
        ?? sibs.slice().sort((a, b) => Math.abs(entryWindow(a)!.n - i.n) - Math.abs(entryWindow(b)!.n - i.n))[0];
      if (!target) { store.set(patch); answerWhenReady(d, "noWindow", source, correctable, null); return; }
      store.set({ ...patch, layerId: target.id, timeMode: "completa", year: null, windowEnd: null });
      answerWhenReady(d, store.get().selection ? "area" : "summary", source, correctable, target.id);
      return;
    }
    case "compare": {
      if (sibs.length < 2) { store.set(patch); answerWhenReady(d, "noWindow", source, correctable, null); return; }
      const idx = sibs.findIndex((e) => e.id === before.layerId);
      const target = idx === sibs.length - 1 ? sibs[0] : sibs[sibs.length - 1];
      store.set({ ...patch, layerId: target.id, timeMode: "completa", year: null, windowEnd: null });
      answerWhenReady(d, "compare", source, correctable, target.id);
      return;
    }
    case "year": {
      const years = m?.series?.years ?? [];
      if (!years.length) { store.set(patch); answerWhenReady(d, "noWindow", source, correctable, null); return; }
      const y = i.y !== null && years.includes(i.y) ? i.y : years.at(-1)!;
      store.set({ ...patch, timeMode: "anual", year: y });
      answerWhenReady(d, "year", source, correctable, null);
      return;
    }
    case "accumulated": {
      const ends = m?.windows?.ends ?? [];
      if (!ends.length) { store.set(patch); answerWhenReady(d, "accumulated", source, correctable, null); return; }
      const end = i.end !== null ? (ends.filter((e) => e <= i.end!).at(-1) ?? ends[0]) : ends.at(-1)!;
      store.set({ ...patch, timeMode: "acumulada", windowEnd: end });
      answerWhenReady(d, "accumulated", source, correctable, null);
      return;
    }
    case "full":
      store.set({ ...patch, timeMode: "completa" });
      answerWhenReady(d, store.get().selection ? "area" : "summary", source, correctable, null);
      return;
    case "area":
    case "greet":
      store.set({ ...patch, timeMode: "completa" });
      answerWhenReady(d, store.get().selection ? "area" : i.t === "greet" ? "help" : "noSelection", source, correctable, null);
      return;
    case "summary": store.set({ ...patch, selection: patch.selection ?? null }); answerWhenReady(d, "summary", source, correctable, null); return;
    case "world": store.set({ selection: null }); answerWhenReady(d, "world", source, correctable, null); return;
    case "filter": store.set({ ...patch, filter: i.verdicts, timeMode: i.verdicts ? "completa" : before.timeMode }); answerWhenReady(d, "filter", source, correctable, null); return;
    case "detect": store.set(patch); answerWhenReady(d, "detect", source, correctable, null); return;
    case "legend": store.set(patch); answerWhenReady(d, "legend", source, false, null); return;
    case "contrast": store.set(patch); answerWhenReady(d, "contrast", source, correctable, null); return;
    case "provenance": store.set(patch); answerWhenReady(d, "provenance", source, correctable, null); return;
    case "help": store.set(patch); answerWhenReady(d, "help", source, false, null); return;
    case "topic": {
      // Live questions look at the place on the map too, so the answer can add HORI's long-term reading.
      const w = i.where ?? (i.topic === "clima" || i.topic === "ganado" ? { name: "Durango", lat: 24.02, lon: -104.67 } : null);
      if (w && ctx.layer && (i.topic === "clima" || i.topic === "ganado")) {
        const idx = cellIndexAt(ctx.layer.manifest, w.lat, w.lon);
        if (idx >= 0) patch.selection = { kind: "cell", index: idx };
      }
      store.set(patch);
      conv.pending = null;
      conv.answer(topicCard(i.topic, w, { ...d.ctx(), state: store.get() }, source));
      return;
    }
    case "imagery": store.set({ ...patch, imagery: i.layer }); answerWhenReady(d, "imagery", source, correctable, null); return;
    case "evolution": {
      // The playback needs a layer with its yearly series: the 2° planet layer has one even when the 0.5° does not.
      const years = m?.series?.years ?? [];
      const yearly = years.length ? null : ctx.entries.find((e) => /annual2deg/.test(e.id)) ?? null;
      if (yearly) {
        store.set({ ...patch, layerId: yearly.id, selection: null, timeMode: "anual", year: null, windowEnd: null, evolution: true });
        answerWhenReady(d, "evolution", source, correctable, yearly.id);
        return;
      }
      store.set({ ...patch, selection: null, timeMode: years.length ? "anual" : before.timeMode, year: years[0] ?? null, evolution: years.length > 0 });
      answerWhenReady(d, "evolution", source, correctable, null);
      return;
    }
    case "advice": answerWhenReady(d, "advice", source, false, null); return;
    case "cause": answerWhenReady(d, "cause", source, false, null); return;
  }
}

/** Called by the app once a new layer is on screen: delivers a waiting card. */
export function flushPending(d: Deps): void {
  const p = d.conv.pending;
  const ctx = d.ctx();
  if (!p || ctx.layer?.manifest.id !== p.waitLayer) return;
  d.conv.pending = null;
  d.conv.answer(compose(p.kind, { ...ctx, state: d.store.get() }, p.source, { correctable: p.correctable }));
}
