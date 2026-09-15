(function () {
  'use strict';

  const empty = type => ({ type: 'FeatureCollection', features: type ? [{ type: 'Feature', properties: {}, geometry: type }] : [] });
  class MapController {
    constructor() { this.map = null; this.container = null; this.fittedRoute = null; }

    mount(container, state) {
      if (!container || !window.maplibregl) return false;
      if (this.container !== container) {
        this.destroy();
        this.container = container;
        this.map = new window.maplibregl.Map({
          container,
          style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] },
          center: state.location ? [state.location.longitude, state.location.latitude] : [72.8347, 19.0607],
          zoom: state.location ? 16 : 12
        });
        this.map.addControl(new window.maplibregl.NavigationControl({ showCompass: true }), 'top-right');
        this.map.on('load', () => { this._addLayers(); this.update(state, true); });
      } else this.update(state);
      return true;
    }

    _addLayers() {
      const addSource = (id, data) => this.map.addSource(id, { type: 'geojson', data });
      addSource('vg-route', empty()); addSource('vg-progress', empty()); addSource('vg-user', empty()); addSource('vg-destination', empty());
      this.map.addLayer({ id: 'vg-route', type: 'line', source: 'vg-route', paint: { 'line-color': '#8090a8', 'line-width': 7, 'line-opacity': .75 } });
      this.map.addLayer({ id: 'vg-progress', type: 'line', source: 'vg-progress', paint: { 'line-color': '#253cec', 'line-width': 8 } });
      this.map.addLayer({ id: 'vg-destination', type: 'circle', source: 'vg-destination', paint: { 'circle-radius': 9, 'circle-color': '#172334', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } });
      this.map.addLayer({ id: 'vg-user-accuracy', type: 'circle', source: 'vg-user', paint: { 'circle-radius': 18, 'circle-color': '#253cec', 'circle-opacity': .14 } });
      this.map.addLayer({ id: 'vg-user', type: 'circle', source: 'vg-user', paint: { 'circle-radius': 8, 'circle-color': '#253cec', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } });
    }

    update(state, forceFit = false) {
      if (!this.map?.isStyleLoaded?.()) return;
      const point = coordinates => empty(coordinates ? { type: 'Point', coordinates } : null);
      const line = coordinates => empty(coordinates?.length > 1 ? { type: 'LineString', coordinates } : null);
      const user = state.location && [state.location.longitude, state.location.latitude];
      const destination = state.destination && [state.destination.longitude, state.destination.latitude];
      this.map.getSource('vg-user')?.setData(point(user));
      this.map.getSource('vg-destination')?.setData(point(destination));
      this.map.getSource('vg-route')?.setData(line(state.route?.coordinates));
      const index = state.progress?.nearestIndex ?? 0;
      this.map.getSource('vg-progress')?.setData(line(state.route?.coordinates?.slice(0, Math.max(2, index + 1))));
      if (user && state.active) this.map.easeTo({ center: user, bearing: state.location.heading || 0, zoom: 17, duration: 500 });
      const routeKey = state.route && `${state.route.coordinates[0]}:${state.route.coordinates.at(-1)}`;
      if (state.route && (forceFit || routeKey !== this.fittedRoute)) {
        const bounds = state.route.coordinates.reduce((box, coord) => box.extend(coord), new window.maplibregl.LngLatBounds(state.route.coordinates[0], state.route.coordinates[0]));
        this.map.fitBounds(bounds, { padding: 55, maxZoom: 17, duration: 0 });
        this.fittedRoute = routeKey;
      } else if (user && !state.route && forceFit) this.map.jumpTo({ center: user, zoom: 16 });
    }

    destroy() { this.map?.remove?.(); this.map = null; this.container = null; this.fittedRoute = null; }
  }

  window.VisionGuideNavigation = { ...(window.VisionGuideNavigation || {}), MapController };
})();
