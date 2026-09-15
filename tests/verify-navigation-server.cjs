const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const base = 47000 + process.pid % 800;
const upstreamPort = base, appPort = base + 1000;
let geocodeCalls = 0, routeBody = null, routeUrl = null, routeUserAgent = '';
const upstream = http.createServer((req, res) => {
  if (req.url.startsWith('/search')) {
    geocodeCalls++; routeUserAgent = req.headers['user-agent'] || '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ place_id: 42, name: 'Test Library', display_name: 'Test Library, Mumbai', lat: '19.1', lon: '72.9', type: 'library' }]));
    return;
  }
  if (req.url.startsWith('/route')) {
    routeUrl = req.url;
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      routeBody = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ paths: [{ distance: 250, time: 210000,
        points: { coordinates: [[72.8, 19], [72.9, 19.1]] },
        instructions: [{ text: 'Continue straight', street_name: 'Test Road', distance: 250, time: 210000, sign: 0, interval: [0, 1] }] }] }));
    });
    return;
  }
  res.writeHead(404).end();
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function retry(url) {
  let error;
  for (let i = 0; i < 40; i++) { try { const response = await fetch(url); if (response.ok) return; } catch (e) { error = e; } await delay(50); }
  throw error || new Error('Server did not start.');
}

(async () => {
  await new Promise(resolve => upstream.listen(upstreamPort, '127.0.0.1', resolve));
  const app = spawn(process.execPath, ['server.cjs'], { windowsHide: true, stdio: 'ignore', env: { ...process.env,
    PORT: String(appPort), GRAPHHOPPER_API_KEY: 'server-only-test-key',
    SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    GRAPHHOPPER_URL: `http://127.0.0.1:${upstreamPort}/route`,
    NOMINATIM_URL: `http://127.0.0.1:${upstreamPort}/search`, NOMINATIM_CONTACT: 'test@example.invalid' } });
  try {
    await retry(`http://127.0.0.1:${appPort}/`);
    const search = await (await fetch(`http://127.0.0.1:${appPort}/api/geocode?q=Test%20Library`)).json();
    assert.equal(search.results[0].name, 'Test Library');
    const cached = await (await fetch(`http://127.0.0.1:${appPort}/api/geocode?q=Test%20Library`)).json();
    assert.equal(cached.cached, true); assert.equal(geocodeCalls, 1);
    assert.match(routeUserAgent, /VisionGuide\/2\.0/);
    const response = await fetch(`http://127.0.0.1:${appPort}/api/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: { latitude: 19, longitude: 72.8 }, to: { latitude: 19.1, longitude: 72.9 } }) });
    const route = await response.json();
    assert.equal(response.status, 200); assert.equal(route.steps[0].streetName, 'Test Road');
    assert.equal(routeBody.profile, 'foot'); assert.deepEqual(routeBody.points[0], [72.8, 19]);
    assert.match(routeUrl, /key=server-only-test-key/);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/vendor/maplibre/maplibre-gl.mjs`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/vendor/supabase/supabase.js`)).status, 200);
    const publicConfig = await (await fetch(`http://127.0.0.1:${appPort}/api/public-config`)).json();
    assert.deepEqual(publicConfig.supabase, { url: 'https://project.supabase.co', publishableKey: 'sb_publishable_test', configured: true });
    assert.equal(JSON.stringify(publicConfig).includes('server-only-test-key'), false);
    console.log('PASS: server-side key protection, public Supabase config, Nominatim cache, GraphHopper foot routing, and local vendor assets.');
  } finally {
    app.kill();
    await new Promise(resolve => upstream.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
