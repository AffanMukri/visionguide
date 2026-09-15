const vm = require('vm');
const fs = require('fs');
const assert = require('assert/strict');

let success, failure, cleared = null;
const geo = {
  watchPosition(ok, bad, options) { success = ok; failure = bad; assert.equal(options.enableHighAccuracy, true); return 17; },
  clearWatch(id) { cleared = id; }
};
const window = { VisionGuideNavigation: {}, fetch: async () => { throw new Error('not mocked'); } };
const context = { window, navigator: { geolocation: geo }, console, Date, Math, Promise, AbortController, setTimeout, clearTimeout };
vm.createContext(context);
for (const file of ['locationService.js', 'destinationSearch.js', 'routingService.js', 'routeTracker.js', 'navigationEngine.js'])
  vm.runInContext(fs.readFileSync(`dist/${file}`, 'utf8'), context);

(async () => {
  const N = window.VisionGuideNavigation;
  const locations = [];
  const service = new N.LocationService({ geolocation: geo, windowSize: 3 });
  service.subscribe(point => locations.push(point));
  const pending = service.start();
  assert.strictEqual(service.start(), pending, 'concurrent callers share one GPS permission request');
  success({ timestamp: 1000, coords: { latitude: 19, longitude: 72.8, accuracy: 12, heading: null, speed: null } });
  const first = await pending;
  assert.equal(first.latitude, 19);
  success({ timestamp: 2000, coords: { latitude: 19.00001, longitude: 72.80001, accuracy: 8, heading: 45, speed: 1.2 } });
  assert.equal(locations.at(-1).heading, 45);
  assert.equal(locations.at(-1).speed, 1.2);
  service.stop(); assert.equal(cleared, 17, 'watchPosition is cleaned up');

  const searchFetch = async url => ({ ok: true, json: async () => ({ results: [{ id: 1, name: 'Library', displayName: 'Library, Mumbai', latitude: 19.1, longitude: 72.9 }] }) });
  const search = new N.DestinationSearch({ fetch: searchFetch });
  const matches = await search.search('Library');
  assert.equal(matches[0].address, 'Library, Mumbai');
  await assert.rejects(() => search.search('x'), /three characters/);

  let routeRequest;
  const routing = new N.RoutingService({ fetch: async (_url, options) => {
    routeRequest = JSON.parse(options.body);
    return { ok: true, json: async () => ({ distance: 222, time: 180000,
      coordinates: [[72.8, 19], [72.801, 19], [72.802, 19]],
      steps: [{ text: 'Continue straight', sign: 0, interval: [0, 1] }, { text: 'Turn right', sign: 2, interval: [1, 2] }] }) };
  }});
  const route = await routing.route({ latitude: 19, longitude: 72.8 }, { latitude: 19, longitude: 72.802 });
  assert.equal(routeRequest.from.latitude, 19);
  assert.equal(route.steps[1].text, 'Turn right');

  const tracker = new N.RouteTracker(route);
  const onRoute = tracker.update({ latitude: 19, longitude: 72.8005, accuracy: 8 });
  assert(onRoute.progress > 0 && onRoute.progress < 1);
  assert.equal(onRoute.shouldReroute, false);
  for (let i = 0; i < 2; i++) assert.equal(tracker.update({ latitude: 19.001, longitude: 72.8005, accuracy: 8 }).shouldReroute, false);
  assert.equal(tracker.update({ latitude: 19.001, longitude: 72.8005, accuracy: 8 }).shouldReroute, true,
    'three accurate off-route readings are required before rerouting');

  let locationListener;
  const fakeLocation = {
    current: { latitude: 19, longitude: 72.8, accuracy: 8 },
    subscribe(fn) { locationListener = fn; }, start() { return Promise.resolve(this.current); }, stop() {}
  };
  const announcements = [];
  const engine = new N.NavigationEngine({ location: fakeLocation, search,
    routing: { route: async () => route }, announce: async (text, options) => { announcements.push({ text, options }); return true; } });
  await engine.chooseDestination({ name: 'Library', latitude: 19, longitude: 72.802 });
  await engine.start();
  locationListener({ latitude: 19, longitude: 72.8009, accuracy: 8, heading: 90, speed: 1 });
  await Promise.resolve();
  assert.equal(engine.getState().active, true);
  assert(announcements.some(item => item.options.priority === 75), 'an immediate turn uses navigation priority 75');

  const inaccurateLocation = { subscribe() {}, start: async () => ({ latitude: 19, longitude: 72.8, accuracy: 50000 }), stop() {} };
  const guardedEngine = new N.NavigationEngine({ location: inaccurateLocation, search, routing: { route: async () => route } });
  await guardedEngine.chooseDestination({ name: 'Approximate origin', latitude: 19.1, longitude: 72.9 });
  assert.match(guardedEngine.getState().routeWarning, /Approximate route preview/);

  const objectSource = fs.readFileSync('dist/objectDetection.js', 'utf8');
  assert.match(objectSource, /urgent \? 100/);
  assert(100 > 75, 'camera danger priority is higher than immediate navigation turns');
  const serverSource = fs.readFileSync('server.cjs', 'utf8');
  assert(serverSource.includes("profile: 'foot'"));
  assert(!fs.readFileSync('dist/routingService.js', 'utf8').includes('GRAPHHOPPER_API_KEY'), 'the browser bundle contains no GraphHopper key');
  console.log('PASS: GPS smoothing and cleanup, submitted search, walking route parsing, progress, off-route confirmation, turn guidance, and Camera Guide speech priority.');
})().catch(error => { console.error(error); process.exitCode = 1; });
