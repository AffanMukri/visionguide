(function () {
  'use strict';

  const N = window.VisionGuideNavigation;
  const ui = {
    engine: null, map: new N.MapController(), helpers: {}, places: [], query: '', mounted: false,

    configure(helpers = {}) {
      this.helpers = helpers;
      if (!this.engine) {
        this.engine = new N.NavigationEngine({ announce: (text, options) => helpers.speak(text, options) });
        this.engine.subscribe(state => this.update(state));
      }
      if (!this.mounted) {
        document.addEventListener('submit', event => {
          if (event.target?.id !== 'navigation-search-form') return;
          event.preventDefault();
          void this.search(event.target.elements.destination?.value);
        });
        document.addEventListener('click', event => {
          const button = event.target.closest?.('[data-nav-action]');
          if (!button) return;
          const action = button.dataset.navAction;
          if (action === 'location') void this.enableLocation();
          if (action === 'microphone') this.microphone();
          if (action === 'result') void this.selectResult(Number(button.dataset.index));
          if (action === 'place') void this.selectPlace(Number(button.dataset.id));
          if (action === 'start') void this.start();
          if (action === 'stop') this.stop();
          if (action === 'repeat') void this.engine.repeat();
        });
        window.addEventListener?.('pagehide', () => this.engine.stop({ announce: false }));
        this.mounted = true;
      }
      return this;
    },

    render(context = {}) {
      this.places = context.places || this.places;
      const state = this.engine?.getState() || {};
      const esc = this.helpers.esc || (value => String(value));
      const icon = this.helpers.icon || (() => '');
      const locationText = state.location
        ? `${state.location.latitude.toFixed(5)}, ${state.location.longitude.toFixed(5)}`
        : state.locationStatus === 'requesting' ? 'Getting an accurate GPS position…' : 'Location permission not requested';
      const destinationText = state.destination ? esc(state.destination.address || state.destination.name) : 'No destination selected';
      const startDisabled = !state.route || state.routeStatus !== 'ready' || state.active;
      return `<div class="page-heading"><div><h1>Navigate</h1><p>Live walking directions, one clear step at a time.</p></div><span class="pill">${icon('navigate')} ${state.active ? 'Navigation active' : 'Walking mode'}</span></div>
        <div class="navigate-layout">
          <section class="card navigation-search-card" aria-labelledby="nav-trip-heading">
            <h2 id="nav-trip-heading">Plan your walk</h2>
            <div class="nav-field-block"><span class="eyebrow">From</span><strong>Current Location</strong><span id="nav-location-copy" class="nav-field-detail">${esc(locationText)}</span>
              <button type="button" class="text-button nav-inline-action" data-nav-action="location" ${state.locationStatus === 'requesting' ? 'disabled' : ''}>${state.location ? 'Refresh live GPS' : 'Enable live GPS'}</button>
              <span id="nav-location-error" class="nav-error" role="alert">${esc(state.locationError || '')}</span>
            </div>
            <form id="navigation-search-form" class="nav-field-block">
              <label class="eyebrow" for="destination-search">To</label>
              <div class="nav-search-row"><input class="search" id="destination-search" name="destination" autocomplete="off" minlength="3" maxlength="160" required placeholder="Search destination…" value="${esc(this.query)}">
                <button type="button" data-nav-action="microphone" class="nav-microphone" aria-label="Speak destination">${icon('voice')}</button>
                <button type="submit" class="primary">Search</button></div>
              <small>Search runs only when submitted; there is no rapid autocomplete.</small>
            </form>
            <div class="nav-suggestions"><h3>Suggested destinations</h3><div class="chips">${this.places.slice(0, 4).map(place => `<button type="button" data-nav-action="place" data-id="${Number(place.id)}">${icon(place.home ? 'home' : 'pin')} ${esc(place.name)}</button>`).join('')}</div></div>
            <div id="navigation-results" class="nav-results" aria-live="polite">${this.resultsMarkup(state)}</div>
          </section>
          <section class="card navigation-route-card">
            <div class="row"><div><span class="eyebrow">Map</span><h2 id="nav-destination-name">${state.destination ? esc(state.destination.name) : 'Your walking route'}</h2></div><span id="nav-gps-quality" class="nav-gps-quality">${this.gpsQuality(state.location)}</span></div>
            <div id="navigation-map" class="navigation-map" role="application" aria-label="Interactive walking route map"><div class="map-fallback">Map loads when MapLibre is available.</div></div>
            <p class="map-attribution-note">Map data © OpenStreetMap contributors</p>
            <div class="nav-endpoints"><div><span>FROM</span><strong>Current Location</strong></div><div><span>TO</span><strong id="nav-destination-copy">${destinationText}</strong></div></div>
            <div class="route-summary" aria-label="Walking route summary"><div><strong id="nav-distance">${this.formatDistance(state.route?.distance)}</strong><small>Distance</small></div><div><strong id="nav-time">${this.formatTime(state.route?.time)}</strong><small>Estimated time</small></div><div><strong id="nav-remaining">${this.formatDistance(state.progress?.remaining ?? state.route?.distance)}</strong><small>Remaining</small></div></div>
            <section class="nav-instruction" aria-live="polite"><span class="eyebrow">Current / next direction</span><h2 id="nav-instruction">${esc(state.instruction || 'Choose a destination to begin.')}</h2><p id="nav-instruction-distance">${state.progress ? `${this.formatDistance(state.progress.distanceToManeuver)} to the next direction` : ''}</p></section>
            <div id="nav-route-status" class="nav-route-status" role="status">${this.routeStatus(state)}</div>
            <div class="nav-actions"><button type="button" class="primary" data-nav-action="start" ${startDisabled ? 'disabled' : ''}>START NAVIGATION</button><button type="button" data-nav-action="stop" ${state.active ? '' : 'disabled'}>STOP NAVIGATION</button><button type="button" class="text-button" data-nav-action="repeat" ${state.route ? '' : 'disabled'}>${icon('voice')} Repeat direction</button></div>
          </section>
        </div>
        <div class="notice">${icon('shield')} GPS and map guidance can be inaccurate. Camera Guide handles immediate obstacles and has voice priority over navigation cues.</div>`;
    },

    mount() {
      const container = document.getElementById('navigation-map');
      if (container) this.map.mount(container, this.engine.getState());
      this.update(this.engine.getState());
    },
    unmountMap() { this.map.destroy(); this.engine?.releaseLocationIfIdle?.(); },

    update(state) {
      const root = document.querySelector('.page-navigate');
      if (!root) { this.map.destroy(); return; }
      const set = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
      set('nav-location-copy', state.location ? `${state.location.latitude.toFixed(5)}, ${state.location.longitude.toFixed(5)} · ±${Math.round(state.location.accuracy)} m` : state.locationStatus === 'requesting' ? 'Getting an accurate GPS position…' : 'Location permission not requested');
      set('nav-location-error', state.locationError || '');
      set('nav-gps-quality', this.gpsQuality(state.location));
      set('nav-destination-name', state.destination?.name || 'Your walking route');
      set('nav-destination-copy', state.destination?.address || state.destination?.name || 'No destination selected');
      set('nav-distance', this.formatDistance(state.route?.distance));
      set('nav-time', this.formatTime(state.route?.time));
      set('nav-remaining', this.formatDistance(state.progress?.remaining ?? state.route?.distance));
      set('nav-instruction', state.instruction || 'Choose a destination to begin.');
      set('nav-instruction-distance', state.progress ? `${this.formatDistance(state.progress.distanceToManeuver)} to the next direction` : '');
      set('nav-route-status', this.routeStatus(state));
      const results = document.getElementById('navigation-results');
      if (results) results.innerHTML = this.resultsMarkup(state);
      const locationButton = document.querySelector('[data-nav-action="location"]');
      if (locationButton) { locationButton.disabled = state.locationStatus === 'requesting'; locationButton.textContent = state.location ? 'Refresh live GPS' : 'Enable live GPS'; }
      const start = document.querySelector('[data-nav-action="start"]');
      if (start) start.disabled = !state.route || state.routeStatus !== 'ready' || state.active;
      const stop = document.querySelector('[data-nav-action="stop"]');
      if (stop) stop.disabled = !state.active;
      this.map.mount(document.getElementById('navigation-map'), state);
      this.map.update(state);
    },

    resultsMarkup(state) {
      const esc = this.helpers.esc || (value => String(value));
      if (state.searchStatus === 'loading') return '<p class="muted">Searching for matching places…</p>';
      if (state.searchError) return `<p class="nav-error" role="alert">${esc(state.searchError)}</p>`;
      if (!state.searchResults?.length) return '';
      return `<h3>Matching locations</h3><div class="nav-result-list">${state.searchResults.map((result, index) => `<button type="button" data-nav-action="result" data-index="${index}"><span class="nav-result-number">${index + 1}</span><span><strong>${esc(result.name)}</strong><small>${esc(result.address)}</small></span></button>`).join('')}</div><p class="muted">Select by touch or say “select result 1”.</p>`;
    },

    async search(query, options = {}) {
      this.query = String(query || '').trim();
      try {
        const results = await this.engine.searchDestinations(this.query);
        if (options.fromVoice) {
          if (results.length === 1) await this.selectResult(0);
          else if (results.length) await this.helpers.speak(`I found ${results.length} matches for ${this.query}. Say select result 1, or choose a result on screen.`, { priority: 45 });
          else await this.helpers.speak(`I could not find ${this.query}. Try a more specific place or address.`, { priority: 45 });
        }
        return results;
      } catch (error) {
        if (error.name !== 'AbortError') this.helpers.toast?.(error.message);
        return [];
      }
    },

    async enableLocation() {
      try { await this.engine.enableLocation(); }
      catch (error) { this.helpers.toast?.(error.message); }
    },
    microphone() {
      if (!window.voiceCommandAPI) { this.helpers.toast?.('Voice recognition is unavailable in this browser.'); return; }
      window.voiceCommandAPI.start();
      this.helpers.speak?.('Say navigate to, followed by your destination.', { priority: 35, interrupt: false });
    },
    async selectResult(index) {
      const result = this.engine.getState().searchResults[index];
      if (!result) return false;
      try { await this.engine.chooseDestination(result); this.helpers.toast?.(`Walking route to ${result.name} is ready.`); return true; }
      catch (error) { this.helpers.toast?.(error.message); return false; }
    },
    async selectPlace(id) {
      const place = this.places.find(item => Number(item.id) === Number(id));
      if (!place) return false;
      if (Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) {
        try { await this.engine.chooseDestination(place); return true; } catch (error) { this.helpers.toast?.(error.message); return false; }
      }
      const results = await this.search(place.address || place.name);
      if (!results.length) return false;
      if (results.length > 1) {
        this.helpers.speak?.(`I found ${results.length} matches for ${place.name}. Select the correct result on screen or say select result 1.`, { priority: 45 });
        return true;
      }
      try { await this.engine.chooseDestination(results[0]); return true; } catch (error) { this.helpers.toast?.(error.message); return false; }
    },
    async selectVoiceResult(number) {
      const ok = await this.selectResult(Math.max(0, Number(number) - 1));
      if (!ok) this.helpers.speak?.('That search result is not available. Say a result number shown on screen.', { priority: 45 });
      return ok;
    },
    async navigateToName(name) {
      const query = String(name || '').trim().toLowerCase();
      const saved = this.places.find(place => place.name.toLowerCase() === query) || this.places.find(place => `${place.name} ${place.address}`.toLowerCase().includes(query));
      if (saved) return this.selectPlace(saved.id);
      this.query = name;
      if (!document.querySelector('.page-navigate')) this.helpers.go?.('navigate');
      const results = await this.search(name, { fromVoice: true });
      return results.length > 0;
    },
    async start() { try { await this.engine.start(); } catch (error) { this.helpers.toast?.(error.message); this.helpers.speak?.(error.message, { priority: 50 }); } },
    stop() { this.engine.stop(); },
    whereAmI() {
      const state = this.engine.getState(), location = state.location;
      if (!location) { this.helpers.speak?.('Live location is not available. Open Navigate and enable live GPS.', { priority: 45 }); return; }
      const route = state.active && state.destination ? ` You are navigating to ${state.destination.name}.` : '';
      this.helpers.speak?.(`Your location is ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}, accurate to about ${Math.round(location.accuracy)} metres.${route}`, { priority: 45 });
    },
    currentInstruction() { return this.engine.repeat(); },
    isActive() { return Boolean(this.engine?.getState().active); },
    getState() { return this.engine?.getState(); },
    gpsQuality(location) { if (!location) return 'GPS waiting'; if (location.accuracy <= 15) return 'GPS strong'; if (location.accuracy <= 40) return 'GPS fair'; if (location.accuracy <= 200) return 'GPS low accuracy'; return 'GPS unusable for routing'; },
    formatDistance(value) { if (!Number.isFinite(Number(value))) return '—'; value = Math.max(0, Number(value)); return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`; },
    formatTime(value) { if (!Number.isFinite(Number(value))) return '—'; return `${Math.max(1, Math.round(Number(value) / 60000))} min`; },
    routeStatus(state) { if (state.rerouting) return 'Off route · recalculating walking directions…'; if (state.routeStatus === 'loading') return state.locationStatus === 'requesting' ? 'Waiting for GPS before calculating the route…' : 'Calculating walking route…'; if (state.routeError) return state.routeError; if (state.routeWarning) return state.routeWarning; if (state.active) return 'Live navigation is running.'; if (state.route) return 'Walking route ready. Start when you are ready.'; return 'Choose a destination to calculate a route.'; }
  };

  window.navigationUI = ui;
})();
