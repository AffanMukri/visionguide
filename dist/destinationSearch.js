(function () {
  'use strict';

  class DestinationSearch {
    constructor(options = {}) {
      this.endpoint = options.endpoint || '/api/geocode';
      this.fetch = options.fetch || window.fetch.bind(window);
      this.controller = null;
    }

    async search(query) {
      query = String(query || '').trim();
      if (query.length < 3) throw new Error('Enter at least three characters to search.');
      this.controller?.abort();
      this.controller = new AbortController();
      let response;
      try {
        response = await this.fetch(`${this.endpoint}?q=${encodeURIComponent(query)}`, {
          signal: this.controller.signal,
          headers: { Accept: 'application/json' }
        });
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new Error('Destination search is unavailable. Check your connection and try again.');
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Destination search failed. Try again.');
      return (body.results || []).map(item => ({
        id: String(item.id),
        name: item.name || item.displayName?.split(',')[0] || query,
        address: item.displayName || item.name || query,
        latitude: Number(item.latitude),
        longitude: Number(item.longitude),
        type: item.type || ''
      })).filter(item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
    }
  }

  window.VisionGuideNavigation = { ...(window.VisionGuideNavigation || {}), DestinationSearch };
})();
