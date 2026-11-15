"use client";

// The app's only chrome (replaces the top header): a left rail with home, new question, Monitoreo, En vivo and
// Evidencia, and language + theme at the bottom. Collapses to icons on desktop; on phones it is a drawer behind a
// floating button. The reading level is NOT here: it lives inside the question box, next to what it changes.

import { useEffect, useState } from "react";
import type { Lang } from "@/core/i18n/texts";
import type { PanelTab } from "./MapPanel";
import { Logo } from "./ui";

const T = {
  es: {
    home: "Inicio", newChat: "Nueva pregunta", map: "Mapa y globo", assistant: "Asistente", monitoring: "Monitoreo", prefs: "Preferencias", live: "En vivo", evidence: "Evidencia",
    theme: "Tema", dark: "Oscuro", light: "Claro", lang: "Idioma", collapse: "Contraer menú", expand: "Expandir menú",
    open: "Abrir menú", close: "Cerrar menú", sections: "Secciones",
  },
  en: {
    home: "Home", newChat: "New question", map: "Map and globe", assistant: "Assistant", monitoring: "Monitoring", prefs: "Preferences", live: "Live", evidence: "Evidence",
    theme: "Theme", dark: "Dark", light: "Light", lang: "Language", collapse: "Collapse menu", expand: "Expand menu",
    open: "Open menu", close: "Close menu", sections: "Sections",
  },
};

const STORE = "h247-rail";

export function Sidebar({ lang, setLang, panel, setPanel, home, onHome, onNew, dark, toggleTheme }: {
  lang: Lang; setLang: (l: Lang) => void; panel: PanelTab | null; setPanel: (p: PanelTab | null) => void;
  home: boolean; onHome: () => void; onNew: () => void; dark: boolean; toggleTheme: () => void;
}) {
  const t = T[lang];
  const [slim, setSlim] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { try { setSlim(localStorage.getItem(STORE) === "slim"); } catch { /* default: wide */ } }, []);
  const toggleSlim = () => setSlim((x) => { try { localStorage.setItem(STORE, x ? "wide" : "slim"); } catch { /* fine */ } return !x; });
  useEffect(() => {
    if (!drawer) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [drawer]);

  const go = (fn: () => void) => () => { fn(); setDrawer(false); };
  const tab = (p: PanelTab) => go(() => setPanel(panel === p ? null : p));
  const wide = !slim || drawer;

  type Item = { key: string; label: string; icon: React.ReactNode; on: boolean; run: () => void };
  const items: Item[] = [
    { key: "home", label: t.home, icon: <path d="M2.5 7.5L8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H9.5v-3.5h-3V13.5H3a.5.5 0 0 1-.5-.5z" />, on: home && !panel, run: go(onHome) },
    { key: "new", label: t.newChat, icon: <path d="M8 3v10M3 8h10" />, on: false, run: go(onNew) },
    { key: "map", label: t.map, icon: <><path d="M1.5 3.5l4-1.5 5 2 4-1.5v10l-4 1.5-5-2-4 1.5z" /><path d="M5.5 2v10M10.5 4v10" /></>, on: panel === "map", run: tab("map") },
    { key: "live", label: t.live, icon: <><circle cx="8" cy="8" r="2" /><path d="M4.5 4.5a5 5 0 0 0 0 7M11.5 4.5a5 5 0 0 1 0 7M2.5 2.5a8 8 0 0 0 0 11M13.5 2.5a8 8 0 0 1 0 11" /></>, on: panel === "live", run: tab("live") },
    { key: "evidence", label: t.evidence, icon: <path d="M2 13.5h12M3 10l3-3 3 2 4-5" />, on: panel === "evidence", run: tab("evidence") },
  ];
  const groups: { label: string; items: Item[] }[] = [
    { label: t.assistant, items: items.slice(0, 2) },
    { label: t.monitoring, items: items.slice(2) },
  ];

  return (
    <>
      <button type="button" onClick={() => setDrawer(true)} aria-label={t.open} aria-expanded={drawer}
        className="fixed left-3 top-3 z-[45] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface/95 text-text shadow-sm backdrop-blur md:hidden">
        <Icon><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /></Icon>
      </button>
      {drawer ? <div aria-hidden="true" onClick={() => setDrawer(false)} className="fixed inset-0 z-[55] bg-black/30 md:hidden" /> : null}

      <nav aria-label={t.sections}
        className={`z-[56] flex shrink-0 flex-col border-r border-border bg-surface-2/60 backdrop-blur transition-[width,transform] duration-200
          max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:w-64 max-md:bg-surface max-md:shadow-xl ${drawer ? "max-md:translate-x-0" : "max-md:-translate-x-full"}
          ${slim ? "md:w-[60px]" : "md:w-60"}`}>
        <div className={`flex h-16 items-center gap-1 px-3 ${wide ? "justify-between" : "justify-center"}`}>
          {wide ? <button type="button" onClick={go(onHome)} className="rounded-xl px-1 py-1 hover:bg-surface-2" aria-label="HORIZON 247"><Logo /></button> : null}
          <button type="button" onClick={drawer ? () => setDrawer(false) : toggleSlim} aria-label={drawer ? t.close : slim ? t.expand : t.collapse}
            title={drawer ? t.close : slim ? t.expand : t.collapse}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-text-2 hover:bg-surface-2 hover:text-text">
            <Icon>{drawer ? <path d="M4 4l8 8M12 4l-8 8" /> : <><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M6 2.5v11" /></>}</Icon>
          </button>
        </div>

        <div className="flex flex-col gap-5 px-2 pt-2">
          {groups.map((g, gi) => (
            <div key={g.label}>
              {wide ? <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-3">{g.label}</p>
                : gi > 0 ? <div aria-hidden="true" className="mx-3 mb-3 border-t border-border" /> : null}
              <ul className="flex flex-col gap-1" aria-label={g.label}>
                {g.items.map((it) => (
                  <li key={it.key}>
                    <button type="button" onClick={it.run} aria-current={it.on ? "page" : undefined} title={wide ? undefined : it.label}
                      className={`flex h-10 w-full items-center gap-3 rounded-xl text-sm font-medium transition-colors ${wide ? "px-3" : "justify-center"}
                        ${it.on ? "bg-surface text-text shadow-[0_0_0_1px_var(--border)]" : "text-text-2 hover:bg-surface hover:text-text"}`}>
                      <Icon>{it.icon}</Icon>
                      {wide ? <span className="truncate">{it.label}</span> : <span className="sr-only">{it.label}</span>}
                      {wide && it.key === "live" ? <span className="live-dot ml-auto" aria-hidden="true" /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className={`mt-auto flex gap-2 border-t border-border p-3 ${wide ? "items-center" : "flex-col items-center"}`}>
          <div role="radiogroup" aria-label={t.lang}
            className={`relative flex rounded-full bg-surface-2 p-1 shadow-[inset_0_0_0_1px_var(--border)] ${wide ? "flex-1" : "flex-col"}`}>
            {(["es", "en"] as const).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={lang === l} onClick={() => setLang(l)} title={l === "es" ? "Español" : "English"}
                className={`flex h-8 flex-1 items-center justify-center rounded-full px-2.5 text-xs font-semibold tracking-wide transition-all ${lang === l ? "bg-surface text-text shadow-[0_1px_3px_rgba(16,24,40,0.12),0_0_0_1px_var(--border)]" : "text-text-3 hover:text-text"}`}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button type="button" onClick={toggleTheme} title={`${t.theme}: ${dark ? t.dark : t.light}`} aria-label={`${t.theme}: ${dark ? t.dark : t.light}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-2 shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-surface hover:text-text">
            <Icon>{dark ? <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" /> : <><circle cx="8" cy="8" r="3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" /></>}</Icon>
          </button>
        </div>
      </nav>
    </>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {children}
    </svg>
  );
}
