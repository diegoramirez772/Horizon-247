"use client";

import { useState } from "react";
import { FLAG, type CellFinding, type Manifest } from "@/contract/types";
import { flagNames } from "@/core/contract/extra";
import type { Layer } from "@/core/contract/loader";
import { readingLimits, readSelection, type Ctx } from "@/core/assistant/compose";
import { certaintyText } from "@/core/honesty/calibration";
import { shownLimits } from "@/core/honesty/limits";
import { count, num, signed } from "@/core/format/format";
import { FLAG_LABEL, UI, type Lang } from "@/core/i18n/texts";
import type { Selection } from "@/core/state/store";
import { SeriesChart } from "./SeriesChart";

/**
 * «Ver evidencia»: the part behind an answer (doc 01 §4, web-diseno §2.2), for Normal and Experto.
 * Same numbers in every level. Normal: chart, effect, interval, MDE/δ, up to three limits, no p/q.
 * Experto: everything, every flag with its contract bit, and the measured calibration (doc v2 §2.2, §3).
 */
export function EvidenceDetails({ ctx, selection, seriesReady }: { ctx: Ctx; selection: Exclude<Selection, null>; seriesReady: boolean }) {
  const [sure, setSure] = useState(false);
  const s = ctx.state;
  const T = UI[s.lang];
  const layer = ctx.layer as Layer;
  const m = layer.manifest;
  const r = readSelection(ctx, selection);
  if (!r) return null;
  const f = r.finding;
  const expert = s.register === "tecnico";
  const flags = expert ? flagNames(f.flags) : [];
  const limits = shownLimits(readingLimits(ctx, r), s.register);
  const years = m.series?.years ?? [];
  const u = m.variable.unit_per_decade;
  const hasSeries = f.series.length === years.length && years.length > 0;

  return (
    <div className="mt-3 flex flex-col gap-4 border-t border-border pt-3">
      {flags.length ? (
        <ul aria-label={T.flags} className="flex flex-wrap gap-1.5">
          {flags.map((x) => (
            <li key={x} className="rounded-full border border-border-control px-2.5 py-0.5 text-xs">
              {FLAG_LABEL[s.lang][x]}{expert ? <span className="tabular text-text-3"> · {FLAG[x]}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <ul aria-label={s.lang === "es" ? "Límites" : "Limits"} className="flex flex-col gap-1 text-sm text-text-2">
        {limits.map((l) => (
          <li key={l.key} className="flex gap-1.5"><span aria-hidden="true">⚠︎</span><span>{l.text[s.lang]}
            {expert && l.bit !== null ? <span className="tabular text-text-3"> · bit {l.bit}</span> : null}</span></li>
        ))}
      </ul>

      <section>
        <h3 className="mb-2 text-sm font-semibold">{T.series}</h3>
        {hasSeries ? (
          <SeriesChart values={f.series} years={years} effect={f.effect} unit={m.variable.unit} lang={s.lang} showTrend={f.verdict !== 0} />
        ) : (
          <p className="text-sm text-text-2">{selection.kind === "cell" && m.series && !seriesReady ? T.loading : T.noSeries}</p>
        )}
      </section>

      <table className="tabular w-full text-sm">
        <tbody>
          <Row k={T.effect} v={`${signed(f.effect, s.lang)} ${u}`} />
          <Row k={T.interval} v={`${signed(f.ci[0], s.lang)} … ${signed(f.ci[1], s.lang)} ${u}`} />
          <Row k="MDE" v={`${num(f.mde, s.lang)} ${u}`} />
          <Row k="δ" v={Number.isFinite(f.sigma)
            ? `${num(m.params.delta_sigma_per_decade * f.sigma, s.lang)} ${u} (${num(m.params.delta_sigma_per_decade, s.lang, 1)} σ)`
            : `${num(m.params.delta_sigma_per_decade, s.lang, 1)} σ`} />
          {expert ? (
            <>
              <Row k="p" v={num(f.p, s.lang, 4)} />
              <Row k={`q (FDR, ${count(r.N, s.lang)})`} v={num(f.q, s.lang, 4)} />
            </>
          ) : null}
          {expert && selection.kind === "cell" ? (
            <>
              <Row k={T.methods} v={`${f.nSig} / 3 · ${m.methods.join(", ")}`} />
              <Row k="r̂₁" v={num(f.r1, s.lang)} />
            </>
          ) : null}
        </tbody>
      </table>

      {selection.kind === "cell" && hasSeries ? (
        <button type="button" onClick={() => downloadCsv(f, years, m)}
          className="min-h-10 self-start rounded-[8px] border border-border-control px-3 text-sm hover:bg-surface-2">
          {s.lang === "es" ? "Descargar CSV" : "Download CSV"}
        </button>
      ) : null}

      <section>
        <button type="button" onClick={() => setSure((x) => !x)} aria-expanded={sure}
          className="text-sm font-semibold underline underline-offset-4">{s.lang === "es" ? "¿Qué tan seguro es?" : "How sure is it?"}</button>
        {sure ? <p className="mt-2 text-sm leading-6 text-text-2">{certaintyText(s.register, s.lang)}</p> : null}
      </section>

      <Provenance m={m} lang={s.lang} expert={expert} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr className="border-b border-border last:border-0">
      <th scope="row" className="py-1.5 pr-3 text-left font-normal text-text-2">{k}</th>
      <td className="py-1.5 text-right">{v}</td>
    </tr>
  );
}

function Provenance({ m, lang, expert }: { m: Manifest; lang: Lang; expert: boolean }) {
  const T = UI[lang];
  const d = m.dataset;
  return (
    <section className="text-sm">
      <h3 className="mb-1 font-semibold">{T.provenance}</h3>
      <p>{d.name} · {d.provider} · {d.version}</p>
      <p className="text-text-2">{m.window.start}–{m.window.end} (n = {m.window.n}) · {m.grid.native_resolution_deg}° · {T.licence}: {d.licence}</p>
      {d.doi ? <p className="text-text-2">DOI: {d.doi}</p> : null}
      {expert && d.sha256 ? <p className="break-all text-xs text-text-3">sha256 {d.sha256}</p> : null}
      {d.url ? <a className="break-all text-text-2 underline" href={d.url} target="_blank" rel="noopener noreferrer">{d.url}</a> : null}
    </section>
  );
}

function downloadCsv(c: CellFinding, years: number[], m: Manifest): void {
  const head = `# ${m.id} · ${m.dataset.name} ${m.dataset.version} · ${m.honesty.simulated ? "SIMULATED" : "real"} · cell ${c.index} (${c.lat}, ${c.lon})`;
  const rows = [head, `year,value_${m.variable.unit}`, ...years.map((y, i) => `${y},${Number.isFinite(c.series[i]) ? c.series[i] : ""}`)];
  const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${m.id}_cell_${c.index}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
