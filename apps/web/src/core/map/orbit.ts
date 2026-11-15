// Where a satellite is now, from CelesTrak's mean orbital elements (OMM JSON, no key, CORS open — checked 2026-11-15).
// Kepler orbit + the secular J2 drift of the node and perigee, rotated to the Earth by GMST. It is not SGP4: for low
// orbits the error grows to tens of km per day since the epoch, plenty to place a point on a globe, and the label says so.

export interface Omm {
  OBJECT_NAME: string;
  NORAD_CAT_ID: number;
  EPOCH: string;
  MEAN_MOTION: number; // rev/day
  ECCENTRICITY: number;
  INCLINATION: number; // deg
  RA_OF_ASC_NODE: number; // deg
  ARG_OF_PERICENTER: number; // deg
  MEAN_ANOMALY: number; // deg
}

export interface Sat {
  id: number;
  name: string;
  group: string;
  epoch: number; // ms
  n: number; // rad/s
  a: number; // km
  e: number;
  i: number; // rad
  raan: number; // rad
  argp: number; // rad
  m0: number; // rad
  dRaan: number; // rad/s
  dArgp: number; // rad/s
}

export interface SatPos { lat: number; lon: number; altKm: number; speedKms: number; headingDeg: number }

const MU = 398600.4418, RE = 6378.137, J2 = 1.08262668e-3, D2R = Math.PI / 180;

export function fromOmm(o: Omm, group: string): Sat | null {
  const n = (o.MEAN_MOTION * 2 * Math.PI) / 86400;
  if (!(n > 0) || !(o.ECCENTRICITY < 1)) return null;
  const a = Math.cbrt(MU / (n * n)), e = o.ECCENTRICITY, i = o.INCLINATION * D2R;
  const p = a * (1 - e * e), k = 1.5 * n * J2 * (RE / p) ** 2;
  const epoch = Date.parse(o.EPOCH.endsWith("Z") ? o.EPOCH : o.EPOCH + "Z");
  if (!Number.isFinite(epoch)) return null;
  return {
    id: o.NORAD_CAT_ID, name: o.OBJECT_NAME, group, epoch, n, a, e, i,
    raan: o.RA_OF_ASC_NODE * D2R, argp: o.ARG_OF_PERICENTER * D2R, m0: o.MEAN_ANOMALY * D2R,
    dRaan: -k * Math.cos(i), dArgp: 0.5 * k * (5 * Math.cos(i) ** 2 - 1),
  };
}

/** Greenwich mean sidereal time (rad) at a UTC time in ms. */
export function gmst(ms: number): number {
  const d = ms / 864e5 + 2440587.5 - 2451545.0;
  return ((((280.46061837 + 360.98564736629 * d) % 360) + 360) % 360) * D2R;
}

function eci(s: Sat, ms: number): [number, number, number, number] {
  const dt = (ms - s.epoch) / 1000;
  const M = s.m0 + s.n * dt;
  let E = M;
  for (let k = 0; k < 6; k++) E -= (E - s.e * Math.sin(E) - M) / (1 - s.e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + s.e) * Math.sin(E / 2), Math.sqrt(1 - s.e) * Math.cos(E / 2));
  const r = s.a * (1 - s.e * Math.cos(E));
  const u = s.argp + s.dArgp * dt + nu, O = s.raan + s.dRaan * dt;
  const cu = Math.cos(u), su = Math.sin(u), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(s.i), si = Math.sin(s.i);
  return [r * (cO * cu - sO * su * ci), r * (sO * cu + cO * su * ci), r * su * si, r];
}

function geo(s: Sat, ms: number): { lat: number; lon: number; r: number } {
  const [x, y, z, r] = eci(s, ms);
  const lon = Math.atan2(y, x) - gmst(ms);
  return { lat: Math.asin(z / r) / D2R, lon: ((((lon / D2R) + 540) % 360) + 360) % 360 - 180, r };
}

export function position(s: Sat, ms = Date.now()): SatPos {
  const g = geo(s, ms), g2 = geo(s, ms + 10e3);
  const p1 = g.lat * D2R, p2 = g2.lat * D2R, dl = (g2.lon - g.lon) * D2R;
  const heading = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / D2R;
  return { lat: g.lat, lon: g.lon, altKm: g.r - RE, speedKms: Math.sqrt(MU * (2 / g.r - 1 / s.a)), headingDeg: (heading + 360) % 360 };
}

/** Ground track from `fromMin` to `toMin` minutes around now, one point per `stepMin`. */
export function track(s: Sat, fromMin: number, toMin: number, stepMin = 1, ms = Date.now()): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let t = fromMin; t <= toMin; t += stepMin) { const g = geo(s, ms + t * 60e3); out.push([g.lon, g.lat, g.r - RE]); }
  return out;
}

/** Orbital period in minutes. */
export function periodMin(s: Sat): number { return (2 * Math.PI) / s.n / 60; }
