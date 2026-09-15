(function () {
  'use strict';

  const INDIA_MOBILE = /^[6-9]\d{9}$/;
  const E164 = /^\+[1-9]\d{7,14}$/;

  function normalizePhone(value) {
    let phone = String(value || '').trim().replace(/[\s().-]/g, '');
    if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
    if (/^0[6-9]\d{9}$/.test(phone)) phone = phone.slice(1);
    if (INDIA_MOBILE.test(phone)) phone = `+91${phone}`;
    else if (/^91[6-9]\d{9}$/.test(phone)) phone = `+${phone}`;
    return phone;
  }

  function isValidPhone(value) {
    return E164.test(normalizePhone(value));
  }

  function mapUrl(location) {
    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
    return `https://www.google.com/maps?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  }

  function getFreshLocation(options = {}) {
    return new Promise((resolve, reject) => {
      if (!window.isSecureContext && !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
        reject(new Error('Live location requires the app to be opened over HTTPS.'));
        return;
      }
      if (!navigator.geolocation) {
        reject(new Error('This device or browser does not provide live location.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(position => {
        const { latitude, longitude, accuracy } = position.coords || {};
        if (![latitude, longitude, accuracy].every(Number.isFinite)) {
          reject(new Error('The device returned an invalid location. Please try again outdoors.'));
          return;
        }
        resolve({ latitude, longitude, accuracy, capturedAt: new Date(position.timestamp || Date.now()).toISOString() });
      }, error => {
        const message = error?.code === 1
          ? 'Location permission is blocked. Allow precise location for VisionGuide in browser settings, then try again.'
          : error?.code === 2
            ? 'Your location is unavailable. Turn on GPS and mobile data, move outdoors, then try again.'
            : 'Getting your location took too long. Turn on GPS, move outdoors, then try again.';
        reject(new Error(message));
      }, {
        enableHighAccuracy: true,
        maximumAge: Number(options.maximumAge ?? 5000),
        timeout: Number(options.timeout ?? 15000)
      });
    });
  }

  async function request(path, options = {}) {
    if (!window.supabaseAuth?.getAccessToken) throw new Error('Sign in again before sending an emergency alert.');
    const token = await window.supabaseAuth.getAccessToken();
    const response = await window.fetch(path, {
      ...options,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'The emergency message could not be sent.');
      error.code = data.code || 'SOS_REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function sendAlert(contact, location) {
    const phone = normalizePhone(contact?.phone);
    if (!isValidPhone(phone)) throw new Error('Enter the emergency contact phone number with a country code.');
    return request('/api/sos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactName: String(contact?.name || '').slice(0, 60),
        phone,
        location: {
          latitude: Number(location?.latitude), longitude: Number(location?.longitude),
          accuracy: Number(location?.accuracy), capturedAt: location?.capturedAt
        }
      })
    });
  }

  function checkStatus(messageId) {
    return request(`/api/sos-status?id=${encodeURIComponent(messageId)}`);
  }

  function fallbackMessage(location) {
    const accuracy = Math.max(1, Math.round(Number(location?.accuracy) || 0));
    return `EMERGENCY: I may need help. My current location is ${mapUrl(location)} (GPS accuracy about ${accuracy} metres). Please contact me now.`;
  }

  function smsUrl(phone, location) {
    const separator = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ? '&' : '?';
    return `sms:${normalizePhone(phone)}${separator}body=${encodeURIComponent(fallbackMessage(location))}`;
  }

  window.sosAPI = { normalizePhone, isValidPhone, mapUrl, getFreshLocation, sendAlert, checkStatus, fallbackMessage, smsUrl };
})();
