// The team database (Supabase `horizon-247`), read with the PUBLISHABLE key only (supabase/README.md). What the
// public web may do is decided by the database's RLS, not here: read REVIEWED context cards, and send comments or
// error reports. Findings, monitors and runs stay team-only; the web keeps reading them from the static bundles.
// Without the two env vars the web works exactly as before (context.json, no comment box).

import type { ContextCard } from "@/contract/types";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
/** AETHRA · HORIZON 247 (UUIDv5 fixed by `zon db-push`). */
export const WORKSPACE = process.env.NEXT_PUBLIC_HORIZON_WORKSPACE ?? "f4e40f81-6f22-5e4e-8f49-f40e85e93d8c";

export const dbConfigured = (): boolean => !!URL_ && !!KEY;

function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${URL_.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

interface CardRow {
  id: string; region: string; level: ContextCard["level"]; text_es: string; text_en: string;
  source_title: string | null; source_url: string | null; source_year: number | null; status: ContextCard["status"];
}

/** Pure: DB row → the contract's ContextCard (SPEC §8.4). */
export function cardFromRow(r: CardRow): ContextCard {
  return {
    id: r.id, region: r.region, level: r.level, text: { es: r.text_es, en: r.text_en },
    source: { title: r.source_title ?? "", url: r.source_url ?? "", year: r.source_year ?? 0 }, status: r.status,
  };
}

export async function fetchContextCards(): Promise<ContextCard[]> {
  if (!dbConfigured()) return [];
  const r = await rest(`context_cards?select=id,region,level,text_es,text_en,source_title,source_url,source_year,status&workspace_id=eq.${WORKSPACE}`);
  if (!r.ok) throw new Error(`DB ${r.status}`);
  return ((await r.json()) as CardRow[]).map(cardFromRow);
}

export interface FeedbackIn { kind: "error" | "comentario"; message: string; layerId?: string | null; lang: "es" | "en" }

/** Anonymous, write-only (the table has no read policy for the public). The view's URL travels as page_state. */
export async function sendFeedback(f: FeedbackIn): Promise<void> {
  const message = f.message.trim().slice(0, 2000);
  if (!dbConfigured() || !message) throw new Error("no-db");
  const r = await rest("feedback", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      workspace_id: WORKSPACE, kind: f.kind, message, lang: f.lang,
      layer_id: f.layerId ? f.layerId.slice(0, 128) : null,
      page_state: typeof location === "undefined" ? null : location.href.slice(0, 1000),
    }),
  });
  if (!r.ok) throw new Error(`DB ${r.status}`);
}

// ---------------------------------------------------------------- red enjambre (public swarm)
// An anonymous Supabase session (no email, no name) joins «AETHRA · Red pública» and submits reports through
// submit_report_revision: licence + consent, content hash, audit, «submitted» until a team reviewer decides.
// Coordinates are rounded to ~1 km before leaving the browser. Requires anonymous sign-ins on in the project.

export const SWARM = process.env.NEXT_PUBLIC_HORIZON_SWARM ?? "0ac137f8-ea24-5741-b653-a6c5863abd5e";
const SESSION = "h247-sb-session";

interface Session { access_token: string; refresh_token: string; expires_at: number }

function readSession(): Session | null {
  try { const s = JSON.parse(localStorage.getItem(SESSION) ?? "null") as Session | null; return s?.access_token ? s : null; } catch { return null; }
}
function saveSession(s: Session): void { try { localStorage.setItem(SESSION, JSON.stringify(s)); } catch { /* this page only */ } }

async function auth(path: string, body: unknown): Promise<Session> {
  const r = await fetch(`${URL_.replace(/\/$/, "")}/auth/v1/${path}`, {
    method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(r.status === 422 || r.status === 400 ? "anon-off" : `auth ${r.status}`);
  const j = await r.json() as { access_token: string; refresh_token: string; expires_in: number };
  const s = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 };
  saveSession(s);
  return s;
}

/** The anonymous session of this browser (created once, refreshed when it expires). */
export async function anonSession(): Promise<Session> {
  const s = readSession();
  if (s && s.expires_at > Date.now()) return s;
  if (s) { try { return await auth("token?grant_type=refresh_token", { refresh_token: s.refresh_token }); } catch { /* new one below */ } }
  return auth("signup", { data: {} });
}

async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const s = await anonSession();
  return rest(path, { ...init, headers: { Authorization: `Bearer ${s.access_token}`, ...(init.headers ?? {}) } });
}

async function rpc<T>(fn: string, args: unknown): Promise<T> {
  const r = await authed(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`DB ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<T>;
}

export interface SwarmReportIn { text: string; lat: number; lon: number; phenomenon?: string | null; lang: "es" | "en" }

export async function sendSwarmReport(x: SwarmReportIn): Promise<void> {
  if (!dbConfigured()) throw new Error("no-db");
  const text = x.text.trim().slice(0, 2000);
  if (!text) throw new Error("empty");
  const producer = await rpc<string>("join_public_swarm", { p_workspace_id: SWARM });
  const now = new Date().toISOString();
  await rpc("submit_report_revision", {
    p_workspace_id: SWARM, p_producer_id: producer, p_idempotency_key: crypto.randomUUID(),
    p_content: {
      description: text, phenomenon: x.phenomenon ?? null,
      location: { type: "Point", coordinates: [Math.round(x.lon * 100) / 100, Math.round(x.lat * 100) / 100] },
      crs: "EPSG:4326", location_precision_m: 1100, observed_start: now,
      licence: "CC BY 4.0", consent: { publish: true, at: now, scope: "red enjambre HORIZON 247", lang: x.lang },
    },
  });
}

export interface SwarmReport { description: string; phenomenon: string | null; lat: number | null; lon: number | null; at: string }

/** The latest reports of the public swarm (unverified until reviewed). */
export async function listSwarmReports(limit = 20): Promise<SwarmReport[]> {
  if (!dbConfigured()) return [];
  const r = await authed(`report_revisions?select=description,phenomenon,location,created_at&workspace_id=eq.${SWARM}&order=created_at.desc&limit=${limit}`);
  if (!r.ok) throw new Error(`DB ${r.status}`);
  const rows = await r.json() as { description: string; phenomenon: string | null; location: { coordinates?: [number, number] } | null; created_at: string }[];
  return rows.map((x) => ({ description: x.description, phenomenon: x.phenomenon, lon: x.location?.coordinates?.[0] ?? null, lat: x.location?.coordinates?.[1] ?? null, at: x.created_at }));
}
