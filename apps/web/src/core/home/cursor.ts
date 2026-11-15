// «Desde tu última visita» (design doc «Modos de profundidad… v2» §5.2). The cursor is the set of event ids this person
// has marked as seen. Event ids are stable (SPEC §15), so reopening the app never announces the same thing twice.
// «Lo vi» only moves this personal cursor; it is NOT «reconocer alerta» (a shared, audited state change in ZON).
// Stored in this browser only (localStorage, guarded); with accounts it moves to ZON per user.

import type { HomeEvent } from "@/contract/types";

const KEY = "h247.seen.v1";
const MAX = 2000; // old ids are dropped first; an id that comes back after that is shown again, never hidden by mistake

export function loadSeen(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveSeen(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(-MAX)));
  } catch {
    // private window or blocked storage: the page still works, it just forgets
  }
}

/** Adds ids to the cursor without duplicates, keeping the order in which they were seen. */
export function markSeen(seen: string[], ids: string[]): string[] {
  const have = new Set(seen);
  return [...seen, ...ids.filter((id) => !have.has(id) && !!have.add(id))];
}

/** Events not yet seen, newest first (the order ZON wrote them in). */
export function unseen(events: HomeEvent[], seen: string[]): HomeEvent[] {
  const have = new Set(seen);
  return events.filter((e) => !have.has(e.id));
}
