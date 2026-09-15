(function () {
  'use strict';

  class NavigationEngine {
    constructor(options = {}) {
      const N = window.VisionGuideNavigation;
      this.location = options.location || new N.LocationService();
      this.search = options.search || new N.DestinationSearch();
      this.routing = options.routing || new N.RoutingService();
      this.announce = options.announce || (() => Promise.resolve(false));
      this.listeners = new Set();
      this.tracker = null;
      this.announced = new Set();
      this.lastReroute = 0;
      this.state = {
        locationStatus: 'idle', location: null, locationError: '',
        destination: null, searchResults: [], searchStatus: 'idle', searchError: '',
        route: null, routeStatus: 'idle', routeError: '', active: false,
        routeWarning: '', progress: null, instruction: 'Choose a destination to get walking directions.', rerouting: false
      };
      this.location.subscribe(point => this._onLocation(point), error => {
        this._set({ locationStatus: 'error', locationError: error.message });
      });
    }

    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    getState() { return this.state; }
    _set(change) { this.state = { ...this.state, ...change }; this.listeners.forEach(fn => fn(this.state)); }

    async enableLocation() {
      this._set({ locationStatus: 'requesting', locationError: '' });
      try {
        const point = await this.location.start();
        if (point) this._set({ locationStatus: 'ready', location: point });
        return point;
      } catch (error) {
        this._set({ locationStatus: 'error', locationError: error.message });
        throw error;
      }
    }

    async searchDestinations(query) {
      this._set({ searchStatus: 'loading', searchError: '', searchResults: [] });
      try {
        const results = await this.search.search(query);
        this._set({ searchStatus: 'ready', searchResults: results,
          searchError: results.length ? '' : 'No matching places were found. Try a more specific name or address.' });
        return results;
      } catch (error) {
        if (error.name === 'AbortError') return [];
        this._set({ searchStatus: 'error', searchError: error.message, searchResults: [] });
        throw error;
      }
    }

    async chooseDestination(destination) {
      this._set({ destination, route: null, progress: null, routeStatus: 'loading', routeError: '',
        routeWarning: '',
        instruction: `Calculating a walking route to ${destination.name}.`, active: false });
      try {
        const origin = this.state.location || await this.enableLocation();
        if (!origin) throw new Error('Current location is unavailable. Refresh live GPS and try again.');
        const approximate = !Number.isFinite(origin.accuracy) || origin.accuracy > 200;
        const route = await this.routing.route(origin, destination);
        this.tracker = new window.VisionGuideNavigation.RouteTracker(route);
        this.announced.clear();
        this._set({ route, routeStatus: 'ready', routeWarning: approximate
          ? `Approximate route preview: current location accuracy is only ±${Math.round(origin.accuracy || 0)} metres. Live progress will wait for a more precise GPS fix.` : '',
          instruction: route.steps[0]?.text || 'Walking route ready.' });
        return route;
      } catch (error) {
        this._set({ routeStatus: 'error', routeError: error.message,
          instruction: 'Walking route unavailable.' });
        throw error;
      }
    }

    async chooseByName(name) {
      const results = await this.searchDestinations(name);
      if (results.length === 1) await this.chooseDestination(results[0]);
      return results;
    }

    async start() {
      if (!this.state.destination) throw new Error('Choose a destination before starting navigation.');
      const watching = this.location.isWatching ? this.location.isWatching() : Boolean(this.state.location);
      if (!watching) {
        await this.enableLocation();
        await this.chooseDestination(this.state.destination);
      } else if (!this.state.route) await this.chooseDestination(this.state.destination);
      this._set({ active: true, instruction: this.state.route.steps[0]?.text || 'Continue straight.' });
      if (this.state.routeWarning) void this._say('GPS accuracy is low. The route is approximate, and live progress will begin when location becomes more precise.', {
        key: 'navigation-low-accuracy', priority: 72, cooldownMs: 30000
      });
      void this._say(`Navigation started to ${this.state.destination.name}. ${this.state.instruction}`, {
        key: 'navigation-start', priority: 40, cooldownMs: 10000
      });
      return true;
    }

    stop(options = {}) {
      const wasActive = this.state.active;
      this._set({ active: false, rerouting: false, progress: null,
        locationStatus: options.releaseLocation === false ? this.state.locationStatus : 'idle',
        location: options.releaseLocation === false ? this.state.location : null,
        instruction: wasActive ? 'Navigation stopped.' : this.state.instruction });
      if (options.releaseLocation !== false) this.location.stop();
      window.guidanceAPI?.clear?.({ belowPriority: 89, cancelActive: true });
      if (wasActive && options.announce !== false)
        void this._say('Navigation stopped.', { key: 'navigation-stop', priority: 45, interrupt: false });
    }

    destroy() { this.stop({ announce: false }); this.listeners.clear(); }
    releaseLocationIfIdle() {
      if (this.state.active) return;
      this.location.stop();
      if (this.state.locationStatus !== 'idle') this._set({ locationStatus: 'idle', location: null });
    }

    async repeat() {
      const progress = this.state.progress;
      const suffix = progress ? ` ${this._formatDistance(progress.distanceToManeuver)}.` : '';
      return this._say((progress?.step?.text || this.state.instruction) + suffix,
        { key: `navigation-repeat:${Date.now()}`, priority: 75, interrupt: false });
    }

    async _onLocation(point) {
      this._set({ locationStatus: 'ready', location: point, locationError: '' });
      if (!this.state.active || !this.tracker || this.state.rerouting) return;
      const progress = this.tracker.update(point);
      if (!progress.usableAccuracy) {
        this._set({ progress, routeWarning: `Approximate route preview: waiting for better GPS accuracy. Current accuracy is ±${Math.round(point.accuracy)} metres.` });
        return;
      }
      if (this.state.routeWarning) this._set({ routeWarning: '' });
      this._set({ progress, instruction: progress.displayStep?.text || progress.step?.text || 'Continue straight.' });
      if (progress.arrived) {
        this.location.stop();
        this._set({ active: false, locationStatus: 'idle', instruction: 'You have reached your destination.' });
        await this._say('You have reached your destination.', { key: 'navigation-arrived', priority: 80, interrupt: true, cooldownMs: 60000 });
        return;
      }
      if (progress.shouldReroute && Date.now() - this.lastReroute > 30000) {
        await this._reroute(point);
        return;
      }
      this._guide(progress);
    }

    async _reroute(point) {
      this.lastReroute = Date.now();
      this.tracker.resetOffRoute();
      this._set({ rerouting: true, routeStatus: 'loading', instruction: 'Route is being recalculated.' });
      void this._say('You appear to be off route. The walking route is being recalculated.', {
        key: `reroute:${this.lastReroute}`, priority: 68, interrupt: false, cooldownMs: 30000
      });
      try {
        const route = await this.routing.route(point, this.state.destination);
        this.tracker = new window.VisionGuideNavigation.RouteTracker(route);
        this.announced.clear();
        this._set({ route, routeStatus: 'ready', progress: null, rerouting: false,
          instruction: route.steps[0]?.text || 'Continue straight.' });
        void this._say(`New route ready. ${this.state.instruction}`, { key: `reroute-ready:${this.lastReroute}`, priority: 60 });
      } catch (error) {
        this._set({ rerouting: false, routeStatus: 'error', routeError: error.message,
          instruction: 'Could not recalculate the route. Continue carefully and try again.' });
        void this._say(this.state.instruction, { key: `reroute-error:${this.lastReroute}`, priority: 70 });
      }
    }

    _guide(progress) {
      const useUpcoming = Boolean(progress.nextStep && progress.distanceToManeuver <= 55);
      const step = useUpcoming ? progress.nextStep : progress.step;
      if (!step) return;
      const cueIndex = useUpcoming ? progress.stepIndex + 1 : progress.stepIndex;
      const base = `step:${cueIndex}`;
      const isTurn = /turn|keep|roundabout|u-turn/i.test(step.text) || Math.abs(step.sign) > 0;
      let key, text, priority;
      if (useUpcoming && isTurn && progress.distanceToManeuver <= 18) {
        key = `${base}:now`; text = this._immediate(step.text); priority = 75;
      } else if (useUpcoming && isTurn) {
        key = `${base}:prepare`; text = `Prepare to ${step.text.toLowerCase()} in ${this._formatDistance(progress.distanceToManeuver)}.`; priority = 55;
      } else if (!isTurn) {
        key = `${base}:continue`; text = `${step.text}.`; priority = 35;
      } else return;
      if (this.announced.has(key)) return;
      void this._say(text, { key, priority, interrupt: priority >= 75, cooldownMs: 15000 }).then(played => {
        if (played) this.announced.add(key);
      });
    }

    _immediate(text) {
      text = String(text || 'Continue straight').replace(/[.!]+$/, '');
      return /^(turn|keep|continue|make)/i.test(text) ? `${text}.` : `Now, ${text.toLowerCase()}.`;
    }
    _formatDistance(metres) {
      metres = Math.max(0, Number(metres) || 0);
      return metres >= 1000 ? `${(metres / 1000).toFixed(1)} kilometres` : `${Math.max(5, Math.round(metres / 5) * 5)} metres`;
    }
    _say(text, options) { return Promise.resolve(this.announce(text, options)).catch(() => false); }
  }

  window.VisionGuideNavigation = { ...(window.VisionGuideNavigation || {}), NavigationEngine };
})();
