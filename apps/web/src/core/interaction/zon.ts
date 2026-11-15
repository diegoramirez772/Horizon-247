// Client of the ZON API (`zon serve`): monitors, alerts, reports, entity state, health. The web is a static export,
// so ZON is optional: without an address the system actions are simply not offered (the interface never promises
// what the backend cannot do — doc «Interacción v2» §4.2). The key lives only in this browser (localStorage) and
// is sent only to the ZON address the user typed. ZON's CORS allows only Authorization + Content-Type, so there is no
// idempotency header: double writes are prevented on this side (one pending confirmation, button disabled while sending).

export interface ZonConfig { url: string; key: string }

export interface ZonMonitor { id: string; entity: { id?: string; name?: string; status?: string }; variable: { name?: string; unit?: string }; period: number; cadence?: string; org?: string }
export interface ZonAlert { id: string; monitor: string; entity?: string; entity_status?: string; variable: string; type: string; severity: string; state: string; history?: unknown[] }
export interface ZonHealth { status: string; audit_intact: boolean; audit_records: number; sources?: unknown }

const KEY = "h247.zon";
export const ALERT_NEXT: Record<string, string[]> = { abierta: ["reconocida", "derivada", "cerrada"], reconocida: ["derivada", "cerrada"], derivada: ["cerrada"], cerrada: [] };

export function zonConfig(): ZonConfig | null {
  try {
    const env = process.env.NEXT_PUBLIC_ZON_URL;
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<ZonConfig>) : {};
    const url = (saved.url || env || "").replace(/\/+$/, "");
    return url ? { url, key: saved.key ?? "" } : null;
  } catch {
    return null;
  }
}

export function setZonConfig(c: ZonConfig | null): void {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch { /* private mode: config lasts this page only */ }
}

export class ZonError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const c = zonConfig();
  if (!c) throw new ZonError(0, "sin_zon");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (c.key) headers.Authorization = `Bearer ${c.key}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(`${c.url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new ZonError(r.status, (data as { error?: string }).error ?? `HTTP ${r.status}`);
    return data as T;
  } catch (e) {
    if (e instanceof ZonError) throw e;
    throw new ZonError(0, "sin_conexion");
  } finally {
    clearTimeout(timer);
  }
}

export const zon = {
  health: () => call<ZonHealth>("GET", "/health"),
  monitors: () => call<ZonMonitor[]>("GET", "/monitors"),
  alerts: (state?: string) => call<ZonAlert[]>("GET", `/alerts${state ? `?state=${encodeURIComponent(state)}` : ""}`),
  transition: (id: string, to: string, note = "") => call<ZonAlert>("POST", `/alerts/${encodeURIComponent(id)}/transition`, { to, note }),
  entityState: (id: string) => call<Record<string, unknown>>("GET", `/entities/${encodeURIComponent(id)}/state`),
  signals: () => call<unknown[]>("GET", "/swarm/signals"),
  createMonitor: (m: { id: string; entity: Record<string, unknown>; variable: Record<string, unknown>; period: number; cadence?: string; org?: string }) =>
    call<ZonMonitor>("POST", "/monitors", m),
  report: (r: { reporter: { id: string; type: string }; lat: number; lon: number; time: string; text: string; theme?: string }) =>
    call<Record<string, unknown>>("POST", "/reports", r),
};

/** Monitor ids must be lower case without spaces (zon/monitors.py). */
export function monitorId(name: string): string {
  const base = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return base || `monitor-${Date.now().toString(36)}`;
}

/** A stable pseudonymous reporter id for this browser (reports need one; never a name). */
export function reporterId(): string {
  try {
    let id = localStorage.getItem("h247.reporter");
    if (!id) { id = `web-${crypto.randomUUID().slice(0, 8)}`; localStorage.setItem("h247.reporter", id); }
    return id;
  } catch {
    return "web-anonimo";
  }
}
