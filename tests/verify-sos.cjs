const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');

let locationOptions = null, request = null;
const position = { coords: { latitude: 19.0601234, longitude: 72.8364564, accuracy: 9.6 }, timestamp: Date.now() };
const navigator = {
  userAgent: 'Android',
  geolocation: { getCurrentPosition(success, _failure, options) { locationOptions = options; success(position); } }
};
const window = {
  isSecureContext: true,
  location: { hostname: 'visionguide.example' },
  supabaseAuth: { async getAccessToken() { return 'user-access-token'; } },
  async fetch(path, options) {
    request = { path, options };
    return { ok: true, status: 202, json: async () => ({ ok: true, messageId: `SM${'a'.repeat(32)}`, status: 'queued' }) };
  }
};
const context = { window, navigator, console, Date, Promise, Number, String, RegExp, encodeURIComponent, Error };
vm.createContext(context);
vm.runInContext(fs.readFileSync('dist/sosService.js', 'utf8'), context);

(async () => {
  const api = window.sosAPI;
  assert.equal(api.normalizePhone('98765 43210'), '+919876543210');
  assert.equal(api.normalizePhone('09876543210'), '+919876543210');
  assert.equal(api.normalizePhone('0091-98765-43210'), '+919876543210');
  assert.equal(api.isValidPhone('+919876543210'), true);
  assert.equal(api.isValidPhone('1234'), false);

  const location = await api.getFreshLocation();
  assert.equal(location.latitude, position.coords.latitude);
  assert.equal(locationOptions.enableHighAccuracy, true);
  assert.equal(locationOptions.maximumAge, 5000);
  assert.equal(locationOptions.timeout, 15000);
  assert.equal(api.mapUrl(location), 'https://www.google.com/maps?q=19.060123,72.836456');

  const result = await api.sendAlert({ name: 'Trusted Person', phone: '9876543210' }, location);
  assert.equal(result.status, 'queued');
  assert.equal(request.path, '/api/sos');
  assert.equal(request.options.headers.Authorization, 'Bearer user-access-token');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.phone, '+919876543210');
  assert.equal(payload.location.accuracy, 9.6);
  assert.match(api.fallbackMessage(location), /EMERGENCY:/);
  assert.match(api.fallbackMessage(location), /google\.com\/maps\?q=19\.060123,72\.836456/);
  assert.match(api.smsUrl('9876543210', location), /^sms:\+919876543210\?body=/);

  navigator.userAgent = 'iPhone';
  assert.match(api.smsUrl('+919876543210', location), /^sms:\+919876543210&body=/);
  console.log('PASS: fresh high-accuracy GPS, Indian phone normalization, authenticated SOS request, Google Maps pin, and mobile SMS fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
