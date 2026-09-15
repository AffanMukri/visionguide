const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function loadLocalEnvironment() {
  const environmentFile = path.join(__dirname, '.env.local');
  if (!fs.existsSync(environmentFile)) return;

  const allowedNames = new Set([
    'GRAPHHOPPER_API_KEY', 'GRAPHHOPPER_URL',
    'NOMINATIM_URL', 'NOMINATIM_CONTACT',
    'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'HOST', 'PORT'
  ]);
  for (const rawLine of fs.readFileSync(environmentFile, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match || !allowedNames.has(match[1]) || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value) process.env[match[1]] = value;
  }
}

loadLocalEnvironment();

const root = path.join(__dirname, 'dist');
const mapLibreRoot = path.join(__dirname, 'node_modules', 'maplibre-gl', 'dist');
const supabaseBrowserFile = path.join(__dirname, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.map': 'application/json' };
const graphHopperKey = process.env.GRAPHHOPPER_API_KEY || '';
const graphHopperUrl = process.env.GRAPHHOPPER_URL || 'https://graphhopper.com/api/1/route';
const nominatimUrl = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
const nominatimContact = process.env.NOMINATIM_CONTACT || 'local VisionGuide development';
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const geocodeCache = new Map();
let lastNominatimRequest = 0;
let nominatimQueue = Promise.resolve();

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > limit) reject(new Error('Request is too large.')); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON request.')); } });
    req.on('error', reject);
  });
}

function validPoint(point) {
  return point && Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)) &&
    Math.abs(Number(point.latitude)) <= 90 && Math.abs(Number(point.longitude)) <= 180;
}

async function fetchWithTimeout(url, options = {}, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function geocode(res, requestUrl) {
  const query = String(requestUrl.searchParams.get('q') || '').trim();
  if (query.length < 3 || query.length > 160) return json(res, 400, { error: 'Enter a destination between 3 and 160 characters.' });
  const key = query.toLocaleLowerCase('en');
  const cached = geocodeCache.get(key);
  if (cached && Date.now() - cached.time < 86400000) return json(res, 200, { results: cached.results, cached: true });
  nominatimQueue = nominatimQueue.catch(() => {}).then(async () => {
    const wait = Math.max(0, 1050 - (Date.now() - lastNominatimRequest));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastNominatimRequest = Date.now();
    const url = new URL(nominatimUrl);
    url.searchParams.set('q', query); url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1'); url.searchParams.set('limit', '5');
    const response = await fetchWithTimeout(url, { headers: {
      Accept: 'application/json', 'Accept-Language': 'en',
      'User-Agent': `VisionGuide/2.0 (${nominatimContact})`
    }});
    if (!response.ok) throw new Error(`Geocoder returned HTTP ${response.status}.`);
    const items = await response.json();
    const results = items.map(item => ({ id: item.place_id, name: item.name || item.display_name?.split(',')[0],
      displayName: item.display_name, latitude: Number(item.lat), longitude: Number(item.lon), type: item.type }));
    geocodeCache.set(key, { time: Date.now(), results });
    return results;
  });
  try { return json(res, 200, { results: await nominatimQueue }); }
  catch (error) { return json(res, 502, { error: error.name === 'AbortError' ? 'Destination search timed out.' : 'Destination search provider is unavailable.' }); }
}

async function route(req, res) {
  if (!graphHopperKey) return json(res, 503, { error: 'Walking routing is not configured. Set GRAPHHOPPER_API_KEY on the server.' });
  let body;
  try { body = await readJson(req); } catch (error) { return json(res, 400, { error: error.message }); }
  if (!validPoint(body.from) || !validPoint(body.to)) return json(res, 400, { error: 'Valid origin and destination coordinates are required.' });
  const url = new URL(graphHopperUrl); url.searchParams.set('key', graphHopperKey);
  try {
    const response = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ profile: 'foot', points: [[Number(body.from.longitude), Number(body.from.latitude)], [Number(body.to.longitude), Number(body.to.latitude)]],
        points_encoded: false, instructions: true, locale: 'en', elevation: false }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.paths?.length) return json(res, response.status >= 400 ? response.status : 502,
      { error: data.message || data.hints?.[0]?.message || 'GraphHopper could not calculate a walking route.' });
    const pathData = data.paths[0];
    return json(res, 200, { distance: pathData.distance, time: pathData.time,
      coordinates: pathData.points?.coordinates || [], steps: (pathData.instructions || []).map(step => ({
        text: step.text, streetName: step.street_name, distance: step.distance, time: step.time, sign: step.sign, interval: step.interval
      })) });
  } catch (error) {
    return json(res, 502, { error: error.name === 'AbortError' ? 'Walking route request timed out.' : 'Walking routing provider is unavailable.' });
  }
}

const server = http.createServer((req, res) => {
  let requestUrl;
  try { requestUrl = new URL(req.url, 'http://localhost'); }
  catch { res.writeHead(400).end('Invalid request'); return; }
  if (req.method === 'GET' && requestUrl.pathname === '/api/public-config') {
    json(res, 200, { supabase: { url: supabaseUrl, publishableKey: supabasePublishableKey,
      configured: Boolean(supabaseUrl && supabasePublishableKey) } });
    return;
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/geocode') { void geocode(res, requestUrl); return; }
  if (req.method === 'POST' && requestUrl.pathname === '/api/route') { void route(req, res); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let name;
  try { name = decodeURIComponent(requestUrl.pathname); }
  catch { res.writeHead(400).end('Invalid request'); return; }
  if (name.startsWith('/vendor/maplibre/')) {
    const vendorName = name.slice('/vendor/maplibre/'.length);
    const allowed = new Set(['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css']);
    if (!allowed.has(vendorName)) { res.writeHead(404).end('File not found'); return; }
    const vendorFile = path.join(mapLibreRoot, vendorName);
    fs.readFile(vendorFile, (error, data) => {
      if (error) { res.writeHead(404).end('File not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(vendorFile)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
    return;
  }
  if (name === '/vendor/supabase/supabase.js') {
    fs.readFile(supabaseBrowserFile, (error, data) => {
      if (error) { res.writeHead(404).end('File not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
    return;
  }
  if (name === '/') name = '/index.html';
  const file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end('Not allowed'); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404).end('File not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Stop the other server or set PORT to another number.`
    : error.message);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(`VisionGuide is ready: http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`);
  console.log('Keep this terminal open. Press Ctrl+C to stop.');
});
