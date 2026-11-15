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
