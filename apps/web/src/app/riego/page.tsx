import type { Metadata } from "next";
import finding from "../../../public/bundles/riego/laguna.json";

export const metadata: Metadata = {
  title: "HORIZON 247 · Riego que no se apaga",
  description: "La Laguna, 2001–2025: cuánta tierra sigue verde antes de que abran los canales, dónde crece y dónde mirar primero. Datos MODIS de la NASA, juzgados por HORI.",
};

const ha = (n: number) => `${n.toLocaleString("es-MX")} ha`;
const cell: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--border)", textAlign: "right", whiteSpace: "nowrap" };
const card: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 14, padding: 16, background: "var(--surface)" };

export default function RiegoPage() {
  const a = finding.all;
  const d = finding.region;
  const years = Object.entries(a.green_ha) as [string, number][];
  const top = Math.max(...years.map(([, v]) => v));
  const zones = finding.zones.slice(0, 10);
  const w = a.water_consumed_hm3;
  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "32px 16px 64px", color: "var(--text)" }}>
      <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>HORIZON 247 · {finding.name} · {a.years[0]}–{a.years[a.years.length - 1]}</p>
      <h1 style={{ fontSize: 30, lineHeight: 1.15, margin: "6px 0 10px" }}>El riego que no se apaga en sequía</h1>
      <p style={{ fontSize: 17, lineHeight: 1.5, margin: 0 }}>
        Entre el 18 de febrero y el 21 de marzo, antes de que abran las presas, <b>{ha(a.floor_ha)}</b> siguieron verdes
        incluso en el peor año ({a.floor_year}). En el desierto y sin agua de canal, ese verde es riego de invierno.
      </p>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, margin: "22px 0" }}>
        {[
          ["Piso (año mínimo)", ha(a.floor_ha), `en Durango: ${ha(d.floor_ha)}`],
          ["Año típico", ha(a.median_ha), `en Durango: ${ha(d.median_ha)}`],
          ["Verde nuevo", ha(a.new_ha), `perdido: ${ha(a.lost_ha)}`],
          ["Sube con evidencia (HORI)", ha(a.hori.supported_up_green_ha), `baja: ${ha(a.hori.supported_down_was_green_ha)}`],
        ].map(([k, v, s]) => (
          <div key={k} style={card}>
            <div style={{ fontSize: 13, opacity: 0.7 }}>{k}</div>
            <div style={{ fontSize: 24, fontWeight: 650, margin: "4px 0" }}>{v}</div>
            <div style={{ fontSize: 13, opacity: 0.7 }}>{s}</div>
          </div>
        ))}
      </section>

      <h2 style={{ fontSize: 19, margin: "26px 0 10px" }}>Hectáreas verdes antes del canal, año por año</h2>
      <div style={{ ...card, display: "flex", alignItems: "flex-end", gap: 3, height: 170 }} role="img"
        aria-label={`Hectáreas verdes por año; mínimo ${a.floor_ha} en ${a.floor_year}`}>
        {years.map(([y, v]) => (
          <div key={y} title={`${y}: ${ha(v)}`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
            <div style={{ height: `${(v / top) * 100}%`, borderRadius: 3, background: Number(y) === a.floor_year ? "var(--lvl-danger)" : "var(--lvl-ok)" }} />
            <div style={{ fontSize: 9, textAlign: "center", opacity: 0.6, marginTop: 3 }}>{y.slice(2)}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 19, margin: "26px 0 4px" }}>Dónde mirar primero</h2>
      <p style={{ margin: "0 0 10px", fontSize: 14, opacity: 0.75 }}>Municipios ordenados por verde nuevo más verde que sube con evidencia.</p>
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
          <thead>
            <tr>{["Municipio", "Piso", "Siempre verde", "Nuevo", "Perdido", "Sube (HORI)"].map((h, i) => (
              <th key={h} style={{ ...cell, textAlign: i ? "right" : "left", fontWeight: 600 }}>{h}</th>))}</tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.name}>
                <td style={{ ...cell, textAlign: "left", whiteSpace: "normal" }}>{z.name}</td>
                <td style={cell}>{ha(z.floor_ha)}</td><td style={cell}>{ha(z.core_ha)}</td>
                <td style={cell}>{ha(z.new_ha)}</td><td style={cell}>{ha(z.lost_ha)}</td>
                <td style={cell}>{ha(z.hori_up_green_ha)}</td>
              </tr>))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 19, margin: "26px 0 8px" }}>Qué tan seguro es</h2>
      <div style={{ ...card, fontSize: 15, lineHeight: 1.55 }}>
        <p style={{ margin: "0 0 8px" }}><b>Medido:</b> el verdor de {a.hori.pixels.toLocaleString("es-MX")} pixeles de 5.4 ha (MODIS, NASA), las hectáreas verdes de cada año y el veredicto de HORI por pixel.</p>
        <p style={{ margin: "0 0 8px" }}><b>Inferido:</b> que ese verde es agua de pozo. Se apoya en que las presas abren a mediados de marzo; el satélite no ve pozos.</p>
        <p style={{ margin: "0 0 8px" }}><b>Agua:</b> el producto global de evapotranspiración de la NASA (MOD16) solo ve entre {w.min} y {w.max} hm³ consumidos en esos 80 días.
          {a.floor_water_hm3 ? <> Si el piso fuera alfalfa con la lámina que reporta INIFAP (1.45 m al año), serían unos {Math.round(a.floor_water_hm3.alfalfa_inifap)} hm³ al año.</> : null} La
          diferencia es el hueco: el producto global no sabe que ahí se riega.</p>
        <p style={{ margin: 0 }}><b>Falta:</b> validarlo en campo y con los registros de pozos.</p>
      </div>
      <p style={{ fontSize: 12, opacity: 0.6, marginTop: 14 }}>
        Fuente: {finding.method.product}, DOI {finding.method.doi}, por {finding.method.access}. {finding.evidence.dates} imágenes; huella {finding.evidence.sha256.slice(0, 16)}…
      </p>
    </main>
  );
}
