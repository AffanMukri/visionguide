(function () {
  'use strict';

  class RoutingService {
    constructor(options = {}) {
      this.endpoint = options.endpoint || '/api/route';
      this.fetch = options.fetch || window.fetch.bind(window);
      this.controller = null;
    }

    async route(origin, destination) {
      this.controller?.abort();
      this.controller = new AbortController();
      let response;
      try {
        response = await this.fetch(this.endpoint, {
          method: 'POST', signal: this.controller.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            from: { latitude: origin.latitude, longitude: origin.longitude },
            to: { latitude: destination.latitude, longitude: destination.longitude }
          })
        });
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new Error('Walking directions are unavailable. Check your connection and try again.');
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'A walking route could not be calculated.');
      if (!Array.isArray(body.coordinates) || body.coordinates.length < 2)
        throw new Error('The routing provider returned an incomplete walking route.');
      return {
        distance: Number(body.distance) || 0,
        time: Number(body.time) || 0,
        coordinates: body.coordinates,
        steps: (body.steps || []).map((step, index) => ({
          index,
          text: step.text || 'Continue straight',
          streetName: step.streetName || '',
          distance: Number(step.distance) || 0,
          time: Number(step.time) || 0,
          sign: Number(step.sign) || 0,
          interval: Array.isArray(step.interval) ? step.interval : [0, 0]
        }))
      };
    }
  }

  window.VisionGuideNavigation = { ...(window.VisionGuideNavigation || {}), RoutingService };
})();
