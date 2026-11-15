// Land outline (Natural Earth 110m via the world-atlas package, public domain), built once as a Path2D
// in degrees: x = longitude, y = −latitude. Bundled at build time: no network at run time (doc 03 §5, W6).

import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import land from "world-atlas/land-110m.json";

let cached: Path2D | null = null;

export function landPath(): Path2D {
  if (cached) return cached;
  const topo = land as unknown as Topology<{ land: GeometryCollection }>;
  const geo = feature(topo, topo.objects.land) as GeoJSON.FeatureCollection | GeoJSON.Feature;
  const features = "features" in geo ? geo.features : [geo];
  const p = new Path2D();
  for (const f of features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) {
      for (const ring of poly) {
        ring.forEach(([lon, lat], i) => {
          const prev = ring[i - 1];
          // Avoids the horizontal streak when a ring crosses the antimeridian.
          if (i === 0 || (prev && Math.abs(prev[0] - lon) > 180)) p.moveTo(lon, -lat);
          else p.lineTo(lon, -lat);
        });
      }
    }
  }
  cached = p;
  return p;
}

let rings: [number, number][][] | null = null;

/** Land outline as rings of [lon, lat] (for projections other than the flat one). */
export function landRings(): [number, number][][] {
  if (rings) return rings;
  const topo = land as unknown as Topology<{ land: GeometryCollection }>;
  const geo = feature(topo, topo.objects.land) as GeoJSON.FeatureCollection | GeoJSON.Feature;
  const features = "features" in geo ? geo.features : [geo];
  const out: [number, number][][] = [];
  for (const f of features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) out.push(ring.map(([x, y]) => [x, y] as [number, number]));
  }
  rings = out;
  return out;
}

let mask: { data: Uint8Array; w: number; h: number } | null = null;

/** Land mask rasterised once (0.25°): 1 = land. Lets the globe paint land under the data. */
export function landMask(): { data: Uint8Array; w: number; h: number } {
  if (mask) return mask;
  const w = 1440, h = 720;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.setTransform(4, 0, 0, 4, 720, 360);
  g.fillStyle = "#000";
  g.fill(landPath());
  const px = g.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  mask = { data, w, h };
  return mask;
}
