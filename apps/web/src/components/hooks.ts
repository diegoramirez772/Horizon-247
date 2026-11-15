"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { MAP_THEMES, type MapTheme, type ThemeName } from "@/core/map/palette";
import { DEFAULT_STATE, type AppState, type Store, fromSearch, toSearch } from "@/core/state/store";

export function useAppState(store: Store): AppState {
  return useSyncExternalStore(store.subscribe, store.get, () => DEFAULT_STATE);
}

const REGISTER_KEY = "h247-register";
const THEME_KEY = "h247-theme";

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode: the page still works without it */ }
}

/**
 * After hydration: read the URL (and the remembered register), then keep the URL, <html lang> and the
 * register preference in sync with the state. `hydrated` becomes true once the URL has been read.
 */
export function useUrlSync(store: Store): void {
  useEffect(() => {
    const remembered = read(REGISTER_KEY);
    const base = { ...DEFAULT_STATE, register: remembered === "tecnico" ? "tecnico" as const : DEFAULT_STATE.register };
    store.set({ ...fromSearch(window.location.search, base, navigator.language), hydrated: true });
    const sync = () => {
      const s = store.get();
      const search = toSearch(s);
      if (search !== window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${search}`);
      document.documentElement.lang = s.lang;
      write(REGISTER_KEY, s.register);
    };
    sync();
    return store.subscribe(sync);
  }, [store]);
}

export type ThemePref = ThemeName;

/** Day (default, Diego's brief) or night; remembered in the browser. layout.tsx applies it before paint. */
export function useTheme(): { pref: ThemePref; resolved: ThemeName; mapTheme: MapTheme; setPref: (p: ThemePref) => void } {
  const [pref, setPrefState] = useState<ThemePref>("light");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a client-only preference after hydration
    if (read(THEME_KEY) === "dark") setPrefState("dark");
  }, []);
  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    const root = document.documentElement;
    if (p === "dark") root.setAttribute("data-theme", "dark"); else root.removeAttribute("data-theme");
    write(THEME_KEY, p === "dark" ? "dark" : null);
  }, []);
  return { pref, resolved: pref, mapTheme: MAP_THEMES[pref], setPref };
}

/** A boolean remembered in the browser (e.g. the closed introduction). */
export function useRemembered(key: string): [boolean, () => void] {
  const [value, setValue] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only preference read after hydration
    setValue(read(key) === "1");
  }, [key]);
  const set = useCallback(() => { setValue(true); write(key, "1"); }, [key]);
  return [value, set];
}
