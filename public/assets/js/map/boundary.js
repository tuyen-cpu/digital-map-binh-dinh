import { api } from "../core/api.js?v=vnpt-16";

export async function loadBoundary() {
  return api("/api/boundary");
}

export function drawBoundary(map, geojson) {
  const isFallback = geojson?.properties?.source === "fallback";
  if (!map.getPane("outsideMaskPane")) {
    const pane = map.createPane("outsideMaskPane");
    pane.style.zIndex = "425";
    pane.style.pointerEvents = "none";
  }
  if (!map.getPane("boundaryPane")) {
    const pane = map.createPane("boundaryPane");
    pane.style.zIndex = "450";
    pane.style.pointerEvents = "none";
  }
  const boundaryLayer = L.geoJSON(geojson, {
    pane: "boundaryPane",
    interactive: false,
    style: { color: isFallback ? "#d68c27" : "#0068B5", weight: isFallback ? 3 : 4, opacity: 1, fillColor: "#00AEEF", fillOpacity: .03, dashArray: isFallback ? "8 8" : null }
  }).addTo(map);
  const holes = outerRings(geojson);
  const world = [[-85,-180],[-85,180],[85,180],[85,-180]];
  let maskLayer = null;
  if (holes.length) {
    maskLayer = L.polygon([world, ...holes], {
      pane: "outsideMaskPane",
      interactive: false,
      stroke: false,
      fillColor: "#F3F9FD",
      fillOpacity: 1,
      fillRule: "evenodd"
    }).addTo(map);
  }
  const bounds = boundaryLayer.getBounds();
  if (bounds.isValid()) {
    map.setMaxBounds(bounds.pad(.05));
    map.fitBounds(bounds.pad(.025), { animate:false, padding:[25,25] });
    map.setMinZoom(Math.max(12, map.getBoundsZoom(bounds, false) - 1));
  }
  return { boundaryLayer, maskLayer, isFallback };
}

function outerRings(geojson) {
  const g = geojson?.geometry;
  if (!g) return [];
  const convert = ring => ring.map(([lng,lat]) => [lat,lng]);
  if (g.type === "Polygon") return g.coordinates?.length ? [convert(g.coordinates[0])] : [];
  if (g.type === "MultiPolygon") return g.coordinates.filter(p => p?.[0]?.length).map(p => convert(p[0]));
  return [];
}
