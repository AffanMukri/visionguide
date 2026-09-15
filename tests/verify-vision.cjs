const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function canvas() {
  return {
    width: 0, height: 0, offsetWidth: 300, offsetHeight: 300,
    getContext: () => ({
      drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray() }),
      putImageData() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {},
      lineTo() {}, stroke() {}, fill() {}, save() {}, restore() {}, translate() {},
      rotate() {}, closePath() {}, roundRect() {}, fillText() {},
      measureText: text => ({ width: String(text).length * 7 })
    }),
    toDataURL: () => 'data:image/jpeg;base64,'
  };
}

const nodes = new Map();
const document = {
  createElement: tag => tag === 'canvas' ? canvas() : {},
  getElementById: id => nodes.get(id) || null
};
const window = {};
const context = { window, document, console, setTimeout, clearTimeout, Date, performance };
vm.createContext(context);
for (const file of ['visionConfig.js', 'sceneState.js', 'guidanceManager.js', 'tracker.js', 'depthEstimation.js', 'freeSpaceAnalyzer.js', 'riskEngine.js']) {
  vm.runInContext(fs.readFileSync(`dist/${file}`, 'utf8'), context, { filename: file });
}

const detection = (x, score = 0.9, label = 'person') => ({ class: label, score, bbox: [x, 20, 40, 80] });

(async () => {
  // Rectangular 2→1→2 association used to index outside the padded matrix.
  const tracker = new window.ByteTracker();
  assert.equal(tracker.update([detection(10), detection(160)]).length, 0);
  const one = tracker.update([detection(12)]);
  assert.equal(one.length, 1);
  const firstId = one[0].id;
  const two = tracker.update([detection(14), detection(162)]);
  assert.equal(two.length, 2);
  assert(two.some(track => track.id === firstId), 'matched track ID remains stable');
  assert(two.every(track => track.bbox.every(Number.isFinite)));
  assert.doesNotThrow(() => tracker.update([null, { score: NaN, bbox: [] }, detection(18)]));

  // Size fallback is explicitly uncertain and never fabricates metric distance.
  const distance = window.depthAPI.getDistanceForBBox([20, 20, 220, 220], 300, 300, 1);
  assert.equal(distance.source, 'size-heuristic');
  assert.equal(distance.uncertain, true);
  assert(!/\b\d+(?:\.\d+)?\s*m(?:etre)?s?\b/i.test(distance.detail));

  // A new central obstacle must be raised on the first frame, not after EMA lag.
  const video = { videoWidth: 300, videoHeight: 300 };
  const central = { id: 4, label: 'chair', bbox: [120, 200, 60, 100], distInfo: { zone: 'danger' } };
  const free = window.freeSpaceAPI.analyze(video, [central]);
  const nearCentre = free.grid.find(cell => cell.r === 2 && cell.c === 2);
  assert.equal(nearCentre.status, 'obstacle');
  assert(!/safe to walk/i.test(free.advice.speech));

  // Risk history and direction decisions: two-frame confirmation for non-urgent
  // changes, but complete blockage must stop immediately.
  window.riskAPI.reset();
  const blankGrid = Array.from({ length: 15 }, (_, i) => ({ r: Math.floor(i / 5), c: i % 5, status: 'clear', occupancy: 0 }));
  const baseline = window.riskAPI.computeSafeDir([], { grid: blankGrid }, 300, 300);
  assert.equal(baseline.direction, 'center');
  const medium = [{ id: 7, label: 'chair', bbox: [130, 170, 40, 90], risk: { score: 45, level: 'medium' }, motion: { trajectory: 'stationary' }, distInfo: { zone: 'close' } }];
  const leftFavoured = blankGrid.map(cell => ({ ...cell, status: cell.c >= 2 ? 'obstacle' : 'clear', occupancy: cell.c >= 2 ? 1 : 0 }));
  assert.equal(window.riskAPI.computeSafeDir(medium, { grid: leftFavoured }, 300, 300).direction, 'center');
  assert.equal(window.riskAPI.computeSafeDir(medium, { grid: leftFavoured }, 300, 300).direction, 'left');
  const blocked = blankGrid.map(cell => ({ ...cell, status: 'obstacle', occupancy: 1 }));
  const stopped = window.riskAPI.computeSafeDir([], { grid: blocked }, 300, 300);
  assert.equal(stopped.direction, 'stop');
  assert.match(stopped.speech, /stop/i);

  // The shared scene snapshot is immutable, normalized, and complete enough for
  // overlays, voice questions, and visual guidance to consume the same frame.
  window.sceneStateAPI.begin();
  const scene = window.sceneStateAPI.publish({
    frameId: 3, timestamp: Date.now(), videoWidth: 300, videoHeight: 200,
    tracks: [{ id: 9, label: 'person', score: 0.88, bbox: [205, 20, 60, 130],
      distInfo: { zone: 'close', label: 'near', source: 'relative-depth', relativeDepth: 0.7 },
      motion: { trajectory: 'approaching', approachRate: 0.2 }, risk: { score: 81, level: 'high' } }],
    safeDir: { direction: 'left', speech: 'Person ahead. Move left.', zones: {
      left: { freePct: 90, riskLevel: 'low', safetyScore: 85 },
      center: { freePct: 30, riskLevel: 'high', safetyScore: -10 },
      right: { freePct: 55, riskLevel: 'medium', safetyScore: 35 }
    } }, processingMs: 44
  });
  assert.equal(scene.objects[0].position, 'right');
  assert.equal(scene.objects[0].riskLevel, 'high');
  assert.equal(scene.recommendedDirection, 'left');
  assert(Object.isFrozen(scene) && Object.isFrozen(scene.objects) && Object.isFrozen(scene.objects[0].bbox));

  // A high-priority cue interrupts a lower one and is played before queued work.
  const played = [];
  let currentResolve;
  window.guidanceAPI.configure({
    player: text => { played.push(text); return new Promise(resolve => { currentResolve = resolve; }); },
    cancel: () => { const resolve = currentResolve; currentResolve = null; resolve?.(false); }
  });
  const low = window.guidanceAPI.announce('Low cue', { priority: 20 });
  const queued = window.guidanceAPI.announce('Queued cue', { priority: 30 });
  const high = window.guidanceAPI.announce('Stop now', { priority: 90, interrupt: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(played, ['Low cue', 'Stop now']);
  currentResolve(true);
  await high;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(played, ['Low cue', 'Stop now']);
  assert.equal(await queued, false, 'stale lower-priority cue is dropped after interruption');
  await low;

  console.log('PASS: tracker rectangular matching, honest relative range, immediate hazards, direction hysteresis, blocked-scene stop, normalized scene state, and priority speech queue.');
})().catch(error => { console.error(error); process.exitCode = 1; });
