// Builds the Analytics map's country outlines (public/js/world-shapes.js)
// from Natural Earth's 1:110m countries, downloaded as GeoJSON
// (ne_110m_admin_0_countries.geojson from naturalearthdata.com, or the
// nvkelso/natural-earth-vector repository's geojson folder). The download
// isn't kept in the repository; only what's built from it is.
//
//   node scripts/world-map.mjs <ne_110m_admin_0_countries.geojson>

import { readFileSync, writeFileSync } from "node:fs";
import { countriesPath, shapesFile } from "./world-map-lib.mjs";

const TARGET = new URL("../public/js/world-shapes.js", import.meta.url);

const source = process.argv[2];
if (!source) {
  console.error("Usage: node scripts/world-map.mjs <ne_110m_admin_0_countries.geojson>");
  process.exit(1);
}
const text = shapesFile(countriesPath(JSON.parse(readFileSync(source, "utf8"))));
writeFileSync(TARGET, text);
console.log(`Rebuilt public/js/world-shapes.js (${Math.round(text.length / 1024)} KB).`);
