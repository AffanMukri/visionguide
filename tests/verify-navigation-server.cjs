const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const base = 47000 + process.pid % 800;
const upstreamPort = base, appPort = base + 1000;
let geocodeCalls = 0, routeBody = null, routeUrl = null, routeUserAgent = '';
let authHeaders = null, twilioBody = null, twilioAuthorization = '', twilioStatusCalls = 0;
const messageSid = `SM${'a'.repeat(32)}`;
const upstream = http.createServer((req, res) => {
  if (req.url === '/auth/user') {
    authHeaders = req.headers;
    if (req.headers.authorization !== 'Bearer test-user-jwt') { res.writeHead(401).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'user-1', email: 'walker@example.com', user_metadata: { display_name: 'Test Walker' } }));
    return;
  }
  if (req.url.endsWith('/Messages.json') && req.method === 'POST') {
    twilioAuthorization = req.headers.authorization || '';
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      twilioBody = new URLSearchParams(body);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sid: messageSid, status: 'queued' }));
    });
    return;
  }
  if (req.url.endsWith(`/Messages/${messageSid}.json`) && req.method === 'GET') {
    twilioStatusCalls++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sid: messageSid, status: 'delivered' }));
    return;
  }
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
    SUPABASE_AUTH_USER_URL: `http://127.0.0.1:${upstreamPort}/auth/user`,
    TWILIO_ACCOUNT_SID: `AC${'b'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'server-only-twilio-token',
    TWILIO_FROM_NUMBER: '+15551234567', TWILIO_API_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
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
    assert.equal(JSON.stringify(publicConfig).includes('server-only-twilio-token'), false);

    const unauthorized = await fetch(`http://127.0.0.1:${appPort}/api/sos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(unauthorized.status, 401);
    const sosResponse = await fetch(`http://127.0.0.1:${appPort}/api/sos`, { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: 'Bearer test-user-jwt'
    }, body: JSON.stringify({ contactName: 'Trusted Person', phone: '+919876543210',
      location: { latitude: 19.060123, longitude: 72.836456, accuracy: 12, capturedAt: new Date().toISOString() } }) });
    const sos = await sosResponse.json();
    assert.equal(sosResponse.status, 202); assert.equal(sos.messageId, messageSid); assert.equal(sos.status, 'queued');
    assert.equal(authHeaders.apikey, 'sb_publishable_test');
    assert.equal(twilioBody.get('To'), '+919876543210'); assert.equal(twilioBody.get('From'), '+15551234567');
    assert.match(twilioBody.get('Body'), /EMERGENCY: Test Walker may need help/);
    assert.match(twilioBody.get('Body'), /google\.com\/maps\?q=19\.060123,72\.836456/);
    assert.match(twilioAuthorization, /^Basic /);
    const statusResponse = await fetch(`http://127.0.0.1:${appPort}/api/sos-status?id=${messageSid}`, { headers: { Authorization: 'Bearer test-user-jwt' } });
    const status = await statusResponse.json();
    assert.equal(statusResponse.status, 200); assert.equal(status.status, 'delivered'); assert.equal(status.terminal, true); assert.equal(twilioStatusCalls, 1);
    const duplicate = await fetch(`http://127.0.0.1:${appPort}/api/sos`, { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: 'Bearer test-user-jwt'
    }, body: JSON.stringify({ phone: '+919876543210', location: { latitude: 19, longitude: 72, accuracy: 15 } }) });
    assert.equal(duplicate.status, 429);
    console.log('PASS: key protection, auth, real SOS request, Google Maps pin, delivery status, rate limit, routing, geocoding, and local assets.');
  } finally {
    app.kill();
    await new Promise(resolve => upstream.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
