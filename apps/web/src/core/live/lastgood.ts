// «Último dato bueno»: every live source keeps its last good answer in this browser (Cache Storage), so a slow or missing
// network never leaves the screen empty or stuck on «Revisando…». The network gets `timeoutMs` (4 s); if it is late or
// fails, the last saved copy is shown at once with its time, and the fresh answer replaces it when it arrives.
// Works in development too (no service worker needed). What is being shown from storage is published to the banner.

export const LAST_CACHE = "h247-last-v1";

export interface Got<T> { data: T; savedAt: number; stale: boolean }

// ---- what is on screen from storage (for the banner) ----

type Listener = (s: Map<string, number>) => void;
const staleNow = new Map<string, number>();
const listeners = new Set<Listener>();

export function markStale(source: string, savedAt: number | null): void {
  if (savedAt === null) staleNow.delete(source); else staleNow.set(source, savedAt);
  for (const l of listeners) l(new Map(staleNow));
}

export function subscribeStale(l: Listener): () => void {
  listeners.add(l);
  l(new Map(staleNow));
  return () => { listeners.delete(l); };
}

// ---- storage ----

/** Never wait on storage for long: some browsers leave Cache Storage hanging (private mode, headless). */
function soon<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((ok) => setTimeout(() => ok(fallback), ms))]);
}

let cacheP: Promise<Cache | null> | null = null;
function store(): Promise<Cache | null> {
  if (typeof caches === "undefined") return Promise.resolve(null);
  cacheP ??= soon(caches.open(LAST_CACHE), 800, null);
  return cacheP;
}

const keyOf = (k: string) => `https://h247.local/last/${encodeURIComponent(k)}`;

export async function saveBlob(key: string, body: Blob | string, type: string, savedAt = Date.now()): Promise<void> {
  const c = await store();
  if (!c) return;
  try { await c.put(keyOf(key), new Response(body, { headers: { "content-type": type, "x-saved-at": String(savedAt) } })); } catch { /* quota: fine */ }
}

export async function readSaved(key: string): Promise<{ res: Response; savedAt: number } | null> {
  const c = await store();
  if (!c) return null;
  const res = await soon(c.match(keyOf(key)), 800, undefined);
  if (!res) return null;
  return { res, savedAt: Number(res.headers.get("x-saved-at")) || 0 };
}

// ---- the helper ----

/**
 * JSON from `url` (or any `load`), with the last good copy as a safety net. `key` names the copy (default: the URL);
 * `source` is the short name shown in the banner («Eventos de la NASA»).
 */
export async function lastGood<T>(url: string, opts: {
  source: string; key?: string; timeoutMs?: number; signal?: AbortSignal; parse?: (doc: unknown) => T; init?: RequestInit;
}): Promise<Got<T>> {
  const key = opts.key ?? url;
  const parse = opts.parse ?? ((d: unknown) => d as T);
  const net = fetch(url, { ...opts.init, signal: opts.signal }).then(async (r) => {
    if (!r.ok) throw new Error(`${opts.source} ${r.status}`);
    const text = await r.text();
    const data = parse(JSON.parse(text));
    void saveBlob(key, text, "application/json");
    markStale(opts.source, null);
    return { data, savedAt: Date.now(), stale: false } as Got<T>;
  });
  const late = new Promise<"late">((ok) => setTimeout(() => ok("late"), opts.timeoutMs ?? 4000));
  const first = await Promise.race([net.catch((e: unknown) => e instanceof Error ? e : new Error(String(e))), late]);
  if (first !== "late" && !(first instanceof Error)) return first;
  if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
  const saved = await readSaved(key);
  if (saved) {
    try {
      const data = parse(JSON.parse(await saved.res.text()));
      markStale(opts.source, saved.savedAt);
      net.catch(() => {}); // the fresh answer still lands in storage (and clears the banner) when it arrives
      return { data, savedAt: saved.savedAt, stale: true };
    } catch { /* broken copy: fall through */ }
  }
  if (first instanceof Error) throw first;
  return net; // nothing saved yet: wait for the network after all
}
