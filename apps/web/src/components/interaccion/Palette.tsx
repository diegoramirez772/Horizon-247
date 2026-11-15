"use client";

// The command palette (Ctrl/⌘+K, «comandos», gamepad Start): what can be said HERE, typed or picked. Everything it
// runs goes through hub.hear() — the same path as the voice — so typing «acércate» or saying it is the same thing.
// Also: connecting ZON (address + key, kept only in this browser) and the interaction preferences.

import { useEffect, useMemo, useRef, useState } from "react";
import { normalize } from "@/core/assistant/patterns";
import { targets } from "@/core/interaction/dom";
import { earconsOn, setEarcons } from "@/core/interaction/earcons";
import { rank } from "@/core/interaction/fuzzy";
import { setZonConfig, zon, zonConfig } from "@/core/interaction/zon";
import type { Lang } from "@/core/i18n/texts";
import { useHub, useHubState } from "./context";

type Item = { group: string; say: string; hint?: string };

const GROUPS: Record<Lang, { title: string; items: [string, string?][] }[]> = {
  es: [
    { title: "Preguntar", items: [["¿Qué cambió en el planeta?"], ["¿Qué pasa en Durango?"], ["Año 2010"], ["Compara las ventanas"], ["¿Cuántos años faltan para saberlo?"], ["¿De dónde salen los datos?"], ["Modo experto"], ["Muéstrame Marte"]] },
    { title: "Mover el mapa o la escena", items: [["Acércate", "o «aleja»"], ["Gira a la derecha", "izquierda · arriba · abajo"], ["Gira", "da vueltas hasta «para»"], ["Centra", "vista inicial"], ["Pausa", "o «reproduce» en escenas"]] },
    { title: "Sistema (ZON)", items: [["Mis monitores"], ["Mis alertas"], ["Reconoce la alerta 1", "también «deriva» o «cierra»"], ["Vigila esto", "crea un monitor del lugar elegido"], ["Reporta que…", "dicta un reporte del lugar elegido"], ["Señales del enjambre"], ["Estado del sistema"], ["Conecta ZON"]] },
    { title: "Interfaz", items: [["Muestra números", "di el número de cualquier control"], ["Dicta", "escribir sin teclado"], ["Manos libres", "escucha hasta «deja de escuchar»"], ["Activa gestos", "usar la cámara"], ["Silencio"], ["Repite"], ["Siguiente campo"], ["Más abajo"], ["Cierra"]] },
  ],
  en: [
    { title: "Ask", items: [["What changed on the planet?"], ["What is happening in Durango?"], ["Year 2010"], ["Compare the windows"], ["How many more years to know?"], ["Where does the data come from?"], ["Expert mode"], ["Show me Mars"]] },
    { title: "Move the map or the scene", items: [["Zoom in", "or «zoom out»"], ["Turn right", "left · up · down"], ["Spin", "turns until «stop»"], ["Reset view"], ["Pause", "or «play» in scenes"]] },
    { title: "System (ZON)", items: [["My monitors"], ["My alerts"], ["Acknowledge alert 1", "also «escalate» or «close the alert»"], ["Watch this", "creates a monitor of the chosen place"], ["Report that…", "dictate a report of the chosen place"], ["Swarm signals"], ["System status"], ["Connect ZON"]] },
    { title: "Interface", items: [["Show numbers", "say the number of any control"], ["Dictate", "write without a keyboard"], ["Hands free", "listens until «stop listening»"], ["Gestures on", "use the camera"], ["Silence"], ["Repeat"], ["Next field"], ["Scroll down"], ["Close"]] },
  ],
};

const C = {
  es: {
    title: "Comandos", placeholder: "Escribe o di lo que quieras hacer…", run: "Ejecutar", onScreen: "En esta pantalla", close: "Cerrar",
    zon: "Conectar ZON", zonHelp: "La dirección y la llave se guardan solo en este navegador y solo se envían a esa dirección.",
    url: "Dirección de ZON", key: "Llave (Bearer)", save: "Guardar y comprobar", forget: "Olvidar", ok: "Conectado", fail: "No responde",
    prefs: "Preferencias", sounds: "Sonidos de estado", level: "Nivel de interacción",
    levels: ["I0 · universal (teclado, mando, números)", "I1 · voz", "I2 · voz y gestos", "I3 · nube"],
    keys: "Atajos: Alt+V hablar · Alt+M manos libres · Alt+N números · Alt+G gestos · Ctrl/⌘+K comandos · flechas: moverse entre controles",
    back: "← Comandos",
  },
  en: {
    title: "Commands", placeholder: "Type or say what you want to do…", run: "Run", onScreen: "On this screen", close: "Close",
    zon: "Connect ZON", zonHelp: "The address and key are kept only in this browser and only sent to that address.",
    url: "ZON address", key: "Key (Bearer)", save: "Save and check", forget: "Forget", ok: "Connected", fail: "No answer",
    prefs: "Preferences", sounds: "State sounds", level: "Interaction level",
    levels: ["I0 · universal (keyboard, gamepad, numbers)", "I1 · voice", "I2 · voice and gestures", "I3 · cloud"],
    keys: "Shortcuts: Alt+V talk · Alt+M hands-free · Alt+N numbers · Alt+G gestures · Ctrl/⌘+K commands · arrows: move between controls",
    back: "← Commands",
  },
};

export function Palette({ lang }: { lang: Lang }) {
  const hub = useHub();
  const s = useHubState();
  const c = C[lang];
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, [s.paletteView]);

  const items: Item[] = useMemo(() => {
    const base = GROUPS[lang].flatMap((g) => g.items.map(([say, hint]) => ({ group: g.title, say, hint })));
    const screen = targets().filter((t) => t.name && !t.el.closest("[role=dialog][aria-label]")).slice(0, 40).map((t) => ({ group: c.onScreen, say: t.name }));
    return [...base, ...screen];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the screen once per opening
  }, [lang]);

  const shown = useMemo(() => {
    const n = normalize(q);
    if (!n) return items;
    const contains = items.filter((i) => normalize(i.say).includes(n) || normalize(i.hint ?? "").includes(n));
    const fuzzy = rank(n, items.filter((i) => !contains.includes(i)), (i) => [normalize(i.say)], 0.6).map((r) => r.item);
    return [...contains, ...fuzzy];
  }, [q, items]);

  const run = (text: string) => {
    hub.meta("palette"); // close first, so «Mapa» acts on the screen and not on the palette
    window.setTimeout(() => hub.hear(text.replace(/…$/, ""), "text"), 0);
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center bg-black/30 p-3 pt-[10vh] backdrop-blur-[2px]" onClick={() => hub.meta("palette")}>
      <div role="dialog" aria-modal="true" aria-label={c.title} onClick={(e) => e.stopPropagation()}
        className="flex max-h-[78vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-2xl">
        {s.paletteView === "zon" ? <ZonSettings lang={lang} /> : (
          <>
            <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) run(shown.length && normalize(shown[0].say) === normalize(q) ? shown[0].say : q); }}
              className="flex items-center gap-2 border-b border-border p-3">
              <label htmlFor="h247-palette" className="sr-only">{c.title}</label>
              <input id="h247-palette" ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={c.placeholder} autoComplete="off"
                className="h-11 flex-1 rounded-xl bg-surface-2 px-3 text-base outline-none focus:ring-2 focus:ring-accent" />
              <button type="submit" className="h-11 rounded-xl bg-accent px-4 text-sm font-medium text-on-accent">{c.run}</button>
            </form>
            <div className="min-h-0 flex-1 overflow-y-auto p-2" data-scroll="">
              {groupBy(shown).map(([g, list]) => (
                <section key={g} className="mb-2">
                  <h3 className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-3">{g}</h3>
                  <ul>
                    {list.map((i) => (
                      <li key={`${g}:${i.say}`}>
                        <button type="button" onClick={() => run(i.say)}
                          className="flex w-full items-baseline justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2">
                          <span className="text-sm text-text">«{i.say}»</span>
                          {i.hint ? <span className="truncate text-xs text-text-3">{i.hint}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <Prefs lang={lang} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function groupBy(items: Item[]): [string, Item[]][] {
  const m = new Map<string, Item[]>();
  for (const i of items) m.set(i.group, [...(m.get(i.group) ?? []), i]);
  return [...m.entries()];
}

function Prefs({ lang }: { lang: Lang }) {
  const s = useHubState();
  const c = C[lang];
  const [sounds, setSounds] = useState(earconsOn());
  return (
    <section className="mt-2 border-t border-border px-3 pb-2 pt-3 text-sm">
      <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-text-3">{c.prefs}</h3>
      <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
        <span>{c.sounds}</span>
        <input type="checkbox" checked={sounds} onChange={(e) => { setSounds(e.target.checked); setEarcons(e.target.checked); }} className="h-4 w-4 accent-[var(--accent)]" />
      </label>
      <p className="py-1.5 text-text-2">{c.level}: <span className="font-medium text-text">{c.levels[s.level.level]}</span></p>
      <p className="pt-1 text-xs leading-5 text-text-3">{c.keys}</p>
    </section>
  );
}

function ZonSettings({ lang }: { lang: Lang }) {
  const hub = useHub();
  const c = C[lang];
  const cur = zonConfig();
  const [url, setUrl] = useState(cur?.url ?? "http://127.0.0.1:8247");
  const [key, setKey] = useState(cur?.key ?? "");
  const [state, setState] = useState<"idle" | "busy" | "ok" | "fail">("idle");
  const urlRef = useRef<HTMLInputElement>(null);
  useEffect(() => { urlRef.current?.focus(); }, []);
  const save = async () => {
    setState("busy");
    setZonConfig({ url: url.trim().replace(/\/+$/, ""), key: key.trim() });
    try { await zon.health(); setState("ok"); } catch { setState("fail"); }
  };
  return (
    <div className="p-5">
      <button type="button" onClick={() => hub.meta("palette")} className="sr-only focus:not-sr-only">{c.close}</button>
      <h2 className="text-lg font-semibold">{c.zon}</h2>
      <p className="mt-1 text-sm text-text-2">{c.zonHelp}</p>
      <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="block text-sm">
          <span className="text-text-2">{c.url}</span>
          <input ref={urlRef} value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoComplete="off"
            className="mt-1 h-11 w-full rounded-xl bg-surface-2 px-3 outline-none focus:ring-2 focus:ring-accent" />
        </label>
        <label className="block text-sm">
          <span className="text-text-2">{c.key}</span>
          <input value={key} onChange={(e) => setKey(e.target.value)} type="password" autoComplete="off"
            className="mt-1 h-11 w-full rounded-xl bg-surface-2 px-3 outline-none focus:ring-2 focus:ring-accent" />
        </label>
        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={state === "busy"} className="h-11 flex-1 rounded-full bg-accent font-medium text-on-accent disabled:opacity-60">{state === "busy" ? "…" : c.save}</button>
          <button type="button" onClick={() => { setZonConfig(null); setState("idle"); setKey(""); }} className="h-11 rounded-full border border-border px-4">{c.forget}</button>
        </div>
        {state === "ok" ? <p role="status" className="text-sm font-medium text-[#1a7f37]">{c.ok}</p> : null}
        {state === "fail" ? <p role="status" className="text-sm font-medium text-[#c62828]">{c.fail}</p> : null}
      </form>
    </div>
  );
}
