// A small gazetteer so the assistant can ask NASA POWER about a place by name («¿cómo están las vacas en Torreón?»).
// Coordinates are city centres (rounded to 0.01°): enough for POWER's 0.5° grid. Anything else: write «lat, lon».

import { normalize } from "@/core/assistant/patterns";

export interface Where { name: string; lat: number; lon: number }

const PLACES: [string[], string, number, number][] = [
  [["durango"], "Durango", 24.02, -104.67],
  [["chihuahua"], "Chihuahua", 28.63, -106.07],
  [["torreon", "la laguna", "coahuila"], "Torreón", 25.54, -103.41],
  [["saltillo"], "Saltillo", 25.42, -101.0],
  [["zacatecas"], "Zacatecas", 22.77, -102.58],
  [["mazatlan"], "Mazatlán", 23.25, -106.41],
  [["culiacan", "sinaloa"], "Culiacán", 24.8, -107.39],
  [["hermosillo", "sonora"], "Hermosillo", 29.07, -110.96],
  [["monterrey", "nuevo leon"], "Monterrey", 25.69, -100.32],
  [["guadalajara", "jalisco"], "Guadalajara", 20.67, -103.35],
  [["ciudad de mexico", "cdmx", "mexico df"], "Ciudad de México", 19.43, -99.13],
  [["puebla"], "Puebla", 19.04, -98.21],
  [["oaxaca"], "Oaxaca", 17.07, -96.73],
  [["merida", "yucatan"], "Mérida", 20.97, -89.62],
  [["cancun", "quintana roo"], "Cancún", 21.16, -86.85],
  [["tijuana"], "Tijuana", 32.51, -117.04],
  [["veracruz"], "Veracruz", 19.17, -96.13],
  [["houston"], "Houston", 29.76, -95.37],
  [["nueva york", "new york"], "Nueva York", 40.71, -74.01],
  [["los angeles"], "Los Ángeles", 34.05, -118.24],
  [["bogota"], "Bogotá", 4.71, -74.07],
  [["lima"], "Lima", -12.05, -77.04],
  [["santiago de chile", "santiago"], "Santiago de Chile", -33.45, -70.67],
  [["buenos aires"], "Buenos Aires", -34.6, -58.38],
  [["sao paulo"], "São Paulo", -23.55, -46.63],
  [["madrid"], "Madrid", 40.42, -3.7],
  [["paris"], "París", 48.86, 2.35],
  [["londres", "london"], "Londres", 51.51, -0.13],
  [["el cairo", "cairo"], "El Cairo", 30.04, 31.24],
  [["nairobi"], "Nairobi", -1.29, 36.82],
  [["delhi", "nueva delhi"], "Nueva Delhi", 28.61, 77.21],
  [["tokio", "tokyo"], "Tokio", 35.68, 139.69],
  [["sidney", "sydney"], "Sídney", -33.87, 151.21],
];

/** The default place of the demo (caso titular V1: Durango). */
export const HOME_PLACE: Where = { name: "Durango", lat: 24.02, lon: -104.67 };

export function findPlace(raw: string): Where | null {
  const text = ` ${normalize(raw)} `;
  for (const [keys, name, lat, lon] of PLACES) {
    if (keys.some((k) => text.includes(` ${k} `))) return { name, lat, lon };
  }
  return null;
}
