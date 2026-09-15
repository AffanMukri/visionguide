const vm = require('vm');
const fs = require('fs');
const assert = require('assert/strict');

function node() {
  return {
    dataset: {}, disabled: false, textContent: '', attributes: {}, listeners: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, fn) { this.listeners[name] = fn; }
  };
}

const nodes = Object.fromEntries([
  'voice-toggle', 'voice-status', 'voice-transcript', 'voice-button-label', 'voice-control'
].map(id => [id, node()]));
const calls = [];
const app = {};
for (const name of [
  'startCamera','stopCamera','readText','whereAmI','describeSurroundings','navigateHome',
  'navigateTo','beginNavigation','emergency','confirmEmergency','cancelEmergency','repeat',
  'currentInstruction','goTo','help','speak'
]) app[name] = async (...args) => calls.push([name, ...args]);

class FakeRecognition {
  start() { this.onstart?.(); }
  abort() { this.onerror?.({error:'aborted'}); this.onend?.(); }
}

const window = {
  webkitSpeechRecognition: FakeRecognition,
  visionGuideAPI: app,
  speechSynthesis: { cancel() {} }
};
const context = {
  window,
  document: { getElementById: id => nodes[id] || null },
  console,
  setTimeout: fn => { fn(); return 1; },
  clearTimeout() {}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('dist/voiceCommands.js', 'utf8'), context);

(async () => {
  nodes['voice-toggle'].listeners.click();
  assert.equal(window.voiceCommandAPI.isEnabled(), true);
  assert.equal(window.voiceCommandAPI.isListening(), true);
  assert.equal(nodes['voice-toggle'].attributes['aria-pressed'], 'true');

  await window.voiceCommandAPI.execute('start camera');
  await window.voiceCommandAPI.execute('What\'s ahead?');
  await window.voiceCommandAPI.execute('read text');
  await window.voiceCommandAPI.execute('where am I');
  await window.voiceCommandAPI.execute('navigate home');
  await window.voiceCommandAPI.execute('navigate to Hospital');
  await window.voiceCommandAPI.execute('begin navigation');
  await window.voiceCommandAPI.execute('emergency');
  await window.voiceCommandAPI.execute('confirm emergency');
  await window.voiceCommandAPI.execute('repeat');
  await window.voiceCommandAPI.execute('open settings');
  await window.voiceCommandAPI.execute('voice help');

  assert.deepEqual(calls.slice(0, 12), [
    ['startCamera'], ['describeSurroundings'], ['readText'], ['whereAmI'],
    ['navigateHome'], ['navigateTo','hospital'], ['beginNavigation'], ['emergency'],
    ['confirmEmergency'], ['repeat'], ['goTo','settings'], ['help']
  ]);

  await window.voiceCommandAPI.execute('stop camera');
  assert.deepEqual(calls.at(-1), ['stopCamera']);
  await window.voiceCommandAPI.execute('stop listening');
  assert.equal(window.voiceCommandAPI.isEnabled(), false);
  assert.equal(nodes['voice-toggle'].attributes['aria-pressed'], 'false');
  console.log('PASS: microphone toggle, camera, live scene, OCR, location, navigation, SOS confirmation, repeat, page navigation, help, and stop-listening voice commands.');
})().catch(error => { console.error(error); process.exitCode = 1; });
