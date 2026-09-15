import * as maplibregl from '/vendor/maplibre/maplibre-gl.mjs';

window.maplibregl = maplibregl;
window.dispatchEvent(new Event('maplibre-ready'));
window.navigationUI?.mount?.();
