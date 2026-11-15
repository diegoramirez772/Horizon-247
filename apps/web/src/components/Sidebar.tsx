"use client";

// The app's only chrome (replaces the top header): a left rail with home, Monitoreo, En vivo and
// Evidencia, and language + theme at the bottom. Collapses to icons on desktop; on phones it is a drawer behind a
// floating button. The reading level is NOT here: it lives inside the question box, next to what it changes.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { authConfigured, currentUser, signOut, subscribe } from "@/core/live/auth";
import type { Lang } from "@/core/i18n/texts";
import type { PanelTab } from "./MapPanel";
import { Logo } from "./ui";

const T = {
  es: {
    home: "Asistente", map: "Mapa y globo", assistant: "Asistente", monitoring: "Monitoreo", prefs: "Preferencias", live: "En vivo", evidence: "Evidencia", scene: "Escena generada", zone: "Vista 3D real",
    theme: "Tema", dark: "Oscuro", light: "Claro", lang: "Idioma", collapse: "Contraer menú", expand: "Expandir menú",
    open: "Abrir menú", close: "Cerrar menú", sections: "Secciones",
  },
  en: {
    home: "Assistant", map: "Map and globe", assistant: "Assistant", monitoring: "Monitoring", prefs: "Preferences", live: "Live", evidence: "Evidence", scene: "Generated scene", zone: "Real 3D view",
    theme: "Theme", dark: "Dark", light: "Light", lang: "Language", collapse: "Collapse menu", expand: "Expand menu",
    open: "Open menu", close: "Close menu", sections: "Sections",
  },
};

const STORE = "h247-rail";

export function Sidebar({ lang, setLang, panel, setPanel, home, onHome, dark, toggleTheme, onLogin }: {
  lang: Lang; setLang: (l: Lang) => void; panel: PanelTab | null; setPanel: (p: PanelTab | null) => void;
  home: boolean; onHome: () => void; dark: boolean; toggleTheme: () => void; onLogin: () => void;
}) {
  const t = T[lang];
  const user = useSyncExternalStore(subscribe, currentUser, () => null);
  const [acct, setAcct] = useState(false);
  const acctRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!acct) return;
    const off = (e: PointerEvent) => { if (!acctRef.current?.contains(e.target as Node)) setAcct(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAcct(false); };
    addEventListener("pointerdown", off);
    addEventListener("keydown", esc);
    return () => { removeEventListener("pointerdown", off); removeEventListener("keydown", esc); };
  }, [acct]);
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
    { key: "home", label: t.home, icon: <path d="M8 1.8l1.5 3.9 3.9 1.5-3.9 1.5L8 12.6 6.5 8.7 2.6 7.2l3.9-1.5zM12.5 11l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" />, on: home && !panel, run: go(onHome) },
    { key: "map", label: t.map, icon: <><path d="M1.5 3.5l4-1.5 5 2 4-1.5v10l-4 1.5-5-2-4 1.5z" /><path d="M5.5 2v10M10.5 4v10" /></>, on: panel === "map", run: tab("map") },
    { key: "live", label: t.live, icon: <><circle cx="8" cy="8" r="2" /><path d="M4.5 4.5a5 5 0 0 0 0 7M11.5 4.5a5 5 0 0 1 0 7M2.5 2.5a8 8 0 0 0 0 11M13.5 2.5a8 8 0 0 1 0 11" /></>, on: panel === "live", run: tab("live") },
    { key: "zone", label: t.zone, icon: <><path d="M1.5 12.5l4-6 3 4 2-2.5 4 4.5z" /><circle cx="11.5" cy="4" r="1.5" /></>, on: panel === "zone", run: tab("zone") },
    { key: "scene", label: t.scene, icon: <path d="M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7zM8 8l5.5-3.5M8 8v6.5M8 8L2.5 4.5" />, on: panel === "scene", run: tab("scene") },
    { key: "evidence", label: t.evidence, icon: <path d="M2 13.5h12M3 10l3-3 3 2 4-5" />, on: panel === "evidence", run: tab("evidence") },
  ];
  const groups: { label: string; items: Item[] }[] = [
    { label: "", items: items.slice(0, 1) },
    { label: t.monitoring, items: items.slice(1) },
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
            <div key={gi}>
              {wide && g.label ? <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-3">{g.label}</p>
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

        {/* Footer: one circle (your initial, or a person when signed out). It opens a card with language, theme and session. */}
        <div ref={acctRef} className={`relative mt-auto border-t border-border p-3 ${wide ? "" : "flex justify-center"}`}>
          {acct ? (
            <div role="dialog" aria-label={lang === "es" ? "Cuenta y preferencias" : "Account and preferences"}
              className="widget-in absolute bottom-[calc(100%+8px)] left-2 z-[70] w-64 rounded-2xl border border-border bg-surface p-2 shadow-[0_16px_44px_rgba(16,24,40,0.18)]">
              {user ? (
                <div className="flex items-center gap-2.5 px-2 pb-2 pt-1.5">
                  <Avatar text={user.name || user.email} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{user.name || user.email}</span>
                    <span className="block truncate text-xs text-text-3">{user.email}</span>
                  </span>
                </div>
              ) : authConfigured() ? (
                <button type="button" onClick={() => { setAcct(false); go(onLogin)(); }}
                  className="mb-1 flex h-10 w-full items-center justify-center rounded-xl bg-accent text-sm font-semibold text-on-accent">
                  {lang === "es" ? "Entrar o crear cuenta" : "Sign in or sign up"}
                </button>
              ) : null}
              <div className="space-y-1 border-t border-border pt-2">
                <div className="flex items-center justify-between gap-2 px-2 py-1">
                  <span className="text-sm text-text-2">{t.lang}</span>
                  <div role="radiogroup" aria-label={t.lang} className="flex rounded-full bg-surface-2 p-0.5 shadow-[inset_0_0_0_1px_var(--border)]">
                    {(["es", "en"] as const).map((l) => (
                      <button key={l} type="button" role="radio" aria-checked={lang === l} onClick={() => setLang(l)}
                        className={`h-7 rounded-full px-3 text-xs font-semibold transition-all ${lang === l ? "bg-surface text-text shadow-[0_1px_3px_rgba(16,24,40,0.12),0_0_0_1px_var(--border)]" : "text-text-3 hover:text-text"}`}>
                        {l.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <button type="button" onClick={toggleTheme} className="flex h-9 w-full items-center justify-between rounded-xl px-2 text-sm text-text-2 hover:bg-surface-2 hover:text-text">
                  <span>{t.theme}</span>
                  <span className="flex items-center gap-1.5 text-text">
                    <Icon>{dark ? <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" /> : <><circle cx="8" cy="8" r="3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" /></>}</Icon>
                    <span className="text-xs">{dark ? t.dark : t.light}</span>
                  </span>
                </button>
                {user ? (
                  <button type="button" onClick={() => { setAcct(false); void signOut(); }}
                    className="flex h-9 w-full items-center gap-2 rounded-xl px-2 text-sm text-text-2 hover:bg-surface-2 hover:text-text">
                    <Icon><path d="M6 3H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1H6M10.5 5l3 3-3 3M13.5 8H6" /></Icon>
                    {lang === "es" ? "Cerrar sesión" : "Sign out"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <button type="button" onClick={() => setAcct((x) => !x)} aria-expanded={acct} aria-label={user ? (user.name || user.email) : (lang === "es" ? "Cuenta y preferencias" : "Account and preferences")}
            title={user ? user.email : undefined} className="rounded-full transition-transform hover:scale-105">
            {user ? <Avatar text={user.name || user.email} /> : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-text-2 shadow-[inset_0_0_0_1px_var(--border)]">
                <Icon><><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c.8-2.4 2.7-3.5 5-3.5s4.2 1.1 5 3.5" /></></Icon>
              </span>
            )}
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

function Avatar({ text }: { text: string }) {
  return (
    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2563eb] to-[#0ea5e9] text-sm font-semibold text-white">
      {text.slice(0, 1).toUpperCase()}
    </span>
  );
}
