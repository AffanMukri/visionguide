(function () {
  'use strict';

  class LocationService {
    constructor(options = {}) {
      this.geolocation = options.geolocation || navigator.geolocation;
      this.windowSize = Math.max(2, options.windowSize || 5);
      this.watchId = null;
      this.startPromise = null;
      this.samples = [];
      this.current = null;
      this.listeners = new Set();
      this.errorListeners = new Set();
    }

    subscribe(listener, onError) {
      if (listener) this.listeners.add(listener);
      if (onError) this.errorListeners.add(onError);
      return () => { this.listeners.delete(listener); this.errorListeners.delete(onError); };
    }

    start() {
      if (!this.geolocation) {
        const error = { code: 'UNSUPPORTED', message: 'Live location is unavailable in this browser.' };
        this._error(error);
        return Promise.reject(error);
      }
      if (this.watchId !== null) return this.current ? Promise.resolve(this.current) : this.startPromise;
      this.startPromise = new Promise((resolve, reject) => {
        let settled = false;
        this.watchId = this.geolocation.watchPosition(position => {
          const sample = this._normalise(position);
          if (!sample) return;
          this.current = this._smooth(sample);
          this.listeners.forEach(listener => listener(this.current));
          if (!settled) { settled = true; resolve(this.current); }
        }, raw => {
          const error = this._friendlyError(raw);
          this._error(error);
          if (!settled) { settled = true; this.stop(); reject(error); }
        }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
      });
      return this.startPromise;
    }

    stop() {
      if (this.watchId !== null && this.geolocation) this.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      this.startPromise = null;
      this.samples = [];
    }

    isWatching() { return this.watchId !== null; }
    getCurrent() { return this.current; }

    _normalise(position) {
      const c = position?.coords;
      const latitude = Number(c?.latitude), longitude = Number(c?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return {
        latitude, longitude,
        accuracy: Number.isFinite(Number(c.accuracy)) ? Number(c.accuracy) : Infinity,
        heading: c.heading !== null && c.heading !== undefined && Number.isFinite(Number(c.heading)) ? Number(c.heading) : null,
        speed: c.speed !== null && c.speed !== undefined && Number.isFinite(Number(c.speed)) ? Math.max(0, Number(c.speed)) : null,
        timestamp: Number(position.timestamp) || Date.now()
      };
    }

    _smooth(sample) {
      this.samples.push(sample);
      if (this.samples.length > this.windowSize) this.samples.shift();
      let latitude = 0, longitude = 0, total = 0;
      this.samples.forEach((point, index) => {
        const recency = (index + 1) / this.samples.length;
        const weight = recency / Math.max(5, Math.min(point.accuracy, 100));
        latitude += point.latitude * weight;
        longitude += point.longitude * weight;
        total += weight;
      });
      const previous = this.current;
      let heading = sample.heading, speed = sample.speed;
      if (previous && (!Number.isFinite(heading) || !Number.isFinite(speed))) {
        const seconds = Math.max(.1, (sample.timestamp - previous.timestamp) / 1000);
        const distance = LocationService.distance(previous, sample);
        if (!Number.isFinite(speed)) speed = seconds <= 15 ? distance / seconds : null;
        if (!Number.isFinite(heading) && distance >= 2) heading = LocationService.bearing(previous, sample);
      }
      return { ...sample, latitude: latitude / total, longitude: longitude / total, heading, speed };
    }

    _friendlyError(error) {
      const messages = {
        1: 'Location permission was not allowed. Enable it in your browser site settings and try again.',
        2: 'Your current location could not be determined. Move to an open area and try again.',
        3: 'Getting your location took too long. Try again where GPS reception is clearer.'
      };
      return { code: error?.code || 'UNKNOWN', message: messages[error?.code] || 'Live location stopped unexpectedly. Try again.' };
    }

    _error(error) { this.errorListeners.forEach(listener => listener(error)); }

    static distance(a, b) {
      const rad = Math.PI / 180, earth = 6371000;
      const dLat = (b.latitude - a.latitude) * rad;
      const dLon = (b.longitude - a.longitude) * rad;
      const lat1 = a.latitude * rad, lat2 = b.latitude * rad;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      return 2 * earth * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    static bearing(a, b) {
      const rad = Math.PI / 180;
      const y = Math.sin((b.longitude - a.longitude) * rad) * Math.cos(b.latitude * rad);
      const x = Math.cos(a.latitude * rad) * Math.sin(b.latitude * rad) -
        Math.sin(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.cos((b.longitude - a.longitude) * rad);
      return (Math.atan2(y, x) / rad + 360) % 360;
    }
  }

  window.VisionGuideNavigation = { ...(window.VisionGuideNavigation || {}), LocationService };
})();
