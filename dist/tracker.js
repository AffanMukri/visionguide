// ═══════════════════════════════════════════════════════════════════
//  VisionGuide — ByteTrack Tracker
//
//  Upgrade from SORT → ByteTrack.
//  Key innovation: TWO-ROUND matching uses BOTH high AND low
//  confidence detections to recover temporarily occluded tracks.
//
//  Pipeline per frame:
//    Round 1: Active tracks  ←→ HIGH-conf detections  (IoU ≥ 0.30)
//    Round 2: Lost tracks    ←→ LOW-conf detections   (IoU ≥ 0.50)
//    Round 3: Lost tracks    ←→ leftover HIGH-conf    (IoU ≥ 0.50)
//    New:     Unmatched HIGH-conf → new tentative tracks
//
//  Result vs SORT:
//    SORT drops "Person #1" if occluded for 1 frame → new ID.
//    ByteTrack recovers "Person #1" via low-conf detections → same ID.
//
//  Components:
//    • Kalman Filter        — smooth & predict bounding boxes
//    • IoU + Hungarian      — optimal detection↔track assignment
//    • Track State Machine  — TRACKED → LOST → REMOVED lifecycle
//
//  Exposes: window.ByteTracker (constructor)
//           window.SORTTracker (alias for backward compatibility)
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  /* ─── Tuning Parameters ──────────────────────────────────────── */
  const CFG = window.VisionGuideConfig?.tracker || {};
  const HIGH_THRESH   = CFG.highThreshold ?? 0.45;
  const LOW_THRESH    = CFG.lowThreshold ?? 0.15;
  const IOU_HIGH      = CFG.highIou ?? 0.30;
  const IOU_LOW       = CFG.lowIou ?? 0.50;
  const IOU_RECOVER   = CFG.recoveryIou ?? 0.45;
  const MIN_HITS      = CFG.minHits ?? 2;
  const MAX_LOST_AGE  = CFG.maxLostAge ?? 8;

  /* ─── Track States ───────────────────────────────────────────── */
  const STATE = Object.freeze({
    TRACKED: 'tracked',
    LOST:    'lost',
    REMOVED: 'removed',
  });

  /* ═══════════════════════════════════════════════════════════════
     KALMAN FILTER
     State: [cx, cy, w, h, vcx, vcy, vw, vh]
     Constant-velocity model with diagonal covariance (fast, no BLAS).
  ═══════════════════════════════════════════════════════════════ */
  class KalmanFilter {
    constructor(bbox) {
      const [cx, cy, w, h] = _toCenter(bbox);
      // Initial state
      this.x = [cx, cy, w, h, 0, 0, 0, 0];
      // Process noise — how much we trust the motion model
      this.Q = [1, 1, 2, 2, 0.05, 0.05, 0.01, 0.01];
      // Measurement noise — how much we trust the detector
      this.R = [5, 5, 25, 25];
      // State covariance — start with high uncertainty in velocity
      this.P = [10, 10, 10, 10, 10000, 10000, 10000, 10000];
    }

    predict() {
      // Apply constant-velocity model
      this.x[0] += this.x[4];
      this.x[1] += this.x[5];
      this.x[2] = Math.max(1, this.x[2] + this.x[6]);
      this.x[3] = Math.max(1, this.x[3] + this.x[7]);
      // Grow covariance
      for (let i = 0; i < 8; i++) this.P[i] += this.Q[i];
      return _fromCenter(this.x);
    }

    update(bbox) {
      const [cx, cy, w, h] = _toCenter(bbox);
      // Kalman gain K = P / (P + R)
      const K = [0, 1, 2, 3].map(i => this.P[i] / (this.P[i] + this.R[i]));
      // Innovation
      const y = [cx - this.x[0], cy - this.x[1], w - this.x[2], h - this.x[3]];
      // Update state
      for (let i = 0; i < 4; i++) {
        this.x[i]     += K[i] * y[i];
        // Velocity: EMA blend of current velocity and observed delta
        this.x[i + 4]  = 0.75 * y[i] + 0.25 * this.x[i + 4];
      }
      // Update covariance
      for (let i = 0; i < 4; i++) this.P[i] *= (1 - K[i]);
      return _fromCenter(this.x);
    }

    getBox() { return _fromCenter(this.x); }
  }

  /* ═══════════════════════════════════════════════════════════════
     TRACK  (state machine: TRACKED → LOST → REMOVED)
  ═══════════════════════════════════════════════════════════════ */
  let _nextId = 1;

  class Track {
    constructor(det) {
      this.id      = _nextId++;
      this.label   = det.class;
      this.score   = det.score;
      this.kf      = new KalmanFilter(det.bbox);
      this.bbox    = [...det.bbox];
      this.state   = STATE.TRACKED;
      this.hits    = 1;
      this.age     = 1;
      this.lostAge = 0;
      this.color   = _idColor(this.id);
    }

    predict() {
      this.bbox = this.kf.predict();
      this.age++;
      if (this.state === STATE.LOST) this.lostAge++;
    }

    update(det) {
      this.bbox    = this.kf.update(det.bbox);
      this.score   = det.score;
      this.hits++;
      this.state   = STATE.TRACKED;
      this.lostAge = 0;
    }

    markLost() {
      this.state = STATE.LOST;
    }

    isConfirmed() { return this.hits >= MIN_HITS; }
    isDead()      { return this.state === STATE.REMOVED || this.lostAge > MAX_LOST_AGE; }
  }

  /* ═══════════════════════════════════════════════════════════════
     BYTETRACK TRACKER
  ═══════════════════════════════════════════════════════════════ */
  class ByteTracker {
    constructor() { this.tracks = []; }

    reset() { this.tracks = []; _nextId = 1; }

    /**
     * Update tracker with new frame detections.
     * @param {Array} detections — [{bbox, class, score}, …] from COCO-SSD
     * @returns {Array} confirmed active tracks
     */
    update(detections) {
      detections = (detections || []).filter(d =>
        d && Number.isFinite(d.score) && d.score >= LOW_THRESH &&
        Array.isArray(d.bbox) && d.bbox.length === 4 && d.bbox.every(Number.isFinite) &&
        d.bbox[2] > 0 && d.bbox[3] > 0 && typeof d.class === 'string');
      // ── 0. Predict all tracks ─────────────────────────────────
      this.tracks.forEach(t => t.predict());

      // ── Split detections by quality ───────────────────────────
      const dHigh = detections.filter(d => d.score >= HIGH_THRESH);
      const dLow  = detections.filter(d => d.score >= LOW_THRESH && d.score < HIGH_THRESH);

      // ── Separate track states ─────────────────────────────────
      const tracked = this.tracks.filter(t => t.state === STATE.TRACKED);
      const lost    = this.tracks.filter(t => t.state === STATE.LOST);

      // ══════════════════════════════════════════════════════════
      //  ROUND 1 — Active tracks  ←→  HIGH-confidence detections
      // ══════════════════════════════════════════════════════════
      const r1 = _associate(tracked, dHigh, IOU_HIGH);

      r1.matches.forEach(([ti, di]) => tracked[ti].update(dHigh[di]));

      const unmatchedTracked   = r1.unmatchedTracks.map(i => tracked[i]);
      const unmatchedHighIdxs  = r1.unmatchedDets;   // indices into dHigh

      // ══════════════════════════════════════════════════════════
      //  ROUND 2 — Unmatched TRACKED tracks ←→ LOW-conf detections
      //  (Recovers tracks that were occluded / briefly low-conf)
      // ══════════════════════════════════════════════════════════
      const r2 = _associate(unmatchedTracked, dLow, IOU_LOW);

      r2.matches.forEach(([ti, di]) => unmatchedTracked[ti].update(dLow[di]));
      r2.unmatchedTracks.forEach(i  => unmatchedTracked[i].markLost());

      // ══════════════════════════════════════════════════════════
      //  ROUND 3 — LOST tracks ←→ leftover HIGH-conf detections
      //  (Re-associates tracks that had disappeared for a few frames)
      // ══════════════════════════════════════════════════════════
      const leftoverHigh = unmatchedHighIdxs.map(i => dHigh[i]);
      const r3 = _associate(lost, leftoverHigh, IOU_RECOVER);

      r3.matches.forEach(([ti, di]) => lost[ti].update(leftoverHigh[di]));
      // lost tracks that still didn't match stay LOST (lostAge will grow)

      // ══════════════════════════════════════════════════════════
      //  NEW TRACKS — from leftover unmatched HIGH-conf detections
      // ══════════════════════════════════════════════════════════
      r3.unmatchedDets.forEach(di => this.tracks.push(new Track(leftoverHigh[di])));

      // ── Cull dead tracks ──────────────────────────────────────
      this.tracks = this.tracks.filter(t => !t.isDead());

      // ── Output: confirmed, active tracks ─────────────────────
      return this._output();
    }

    _output() {
      return this.tracks
        .filter(t => t.state === STATE.TRACKED && t.isConfirmed())
        .map(t => ({
          id:    t.id,
          label: t.label,
          score: t.score,
          bbox:  [...t.bbox],
          color: t.color,
          age:   t.age,
          hits:  t.hits,
          state: t.state,
        }));
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     ASSOCIATION  (per-class IoU + Hungarian)
     Returns { matches: [[trackIdx, detIdx], …], unmatchedTracks, unmatchedDets }
  ═══════════════════════════════════════════════════════════════ */
  function _associate(tracks, dets, iouThresh) {
    const empty = {
      matches: [],
      unmatchedTracks: tracks.map((_, i) => i),
      unmatchedDets:   dets.map((_, i) => i),
    };
    if (!tracks.length || !dets.length) return empty;

    // Group by class label so cross-class matches are impossible
    const tByClass = _groupByIndex(tracks, t => t.label);
    const dByClass = _groupByIndex(dets,   d => d.class);

    const matchedT = new Set();
    const matchedD = new Set();
    const matches  = [];

    const classes = new Set([...Object.keys(tByClass), ...Object.keys(dByClass)]);

    classes.forEach(cls => {
      const tIdxs = tByClass[cls] || [];
      const dIdxs = dByClass[cls] || [];
      if (!tIdxs.length || !dIdxs.length) return;

      // Build 1-IoU cost matrix
      const cost = tIdxs.map(ti =>
        dIdxs.map(di => 1 - _iou(tracks[ti].bbox, dets[di].bbox))
      );

      _hungarianAssign(cost).forEach(([ri, ci]) => {
        if (cost[ri][ci] > 1 - iouThresh) return; // IoU too low → reject
        matches.push([tIdxs[ri], dIdxs[ci]]);
        matchedT.add(tIdxs[ri]);
        matchedD.add(dIdxs[ci]);
      });
    });

    return {
      matches,
      unmatchedTracks: tracks.map((_, i) => i).filter(i => !matchedT.has(i)),
      unmatchedDets:   dets.map((_, i) => i).filter(i => !matchedD.has(i)),
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     HUNGARIAN ALGORITHM  (Jonker–Volgenant, O(n³))
  ═══════════════════════════════════════════════════════════════ */
  function _hungarianAssign(cost) {
    const rows = cost.length, cols = cost[0]?.length || 0;
    if (!rows || !cols) return [];
    if (rows > cols) {
      const transposed = Array.from({ length: cols }, (_, c) =>
        Array.from({ length: rows }, (_, r) => cost[r][c]));
      return _hungarianAssign(transposed).map(([c, r]) => [r, c]);
    }

    // Rectangular Hungarian algorithm. It requires rows <= columns, handled
    // above by transposition; padding with Infinity corrupts the potentials.
    const n = rows, m = cols;
    const INF = Number.MAX_SAFE_INTEGER;
    const u = new Array(n + 1).fill(0);
    const v = new Array(m + 1).fill(0);
    const p = new Array(m + 1).fill(0);
    const way = new Array(m + 1).fill(0);

    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minVal = new Array(m + 1).fill(INF);
      const used   = new Array(m + 1).fill(false);
      do {
        used[j0] = true;
        let i0 = p[j0], delta = INF, j1 = -1;
        for (let j = 1; j <= m; j++) {
          if (!used[j]) {
            const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
            if (cur < minVal[j]) { minVal[j] = cur; way[j] = j0; }
            if (minVal[j] < delta) { delta = minVal[j]; j1 = j; }
          }
        }
        for (let j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
          else minVal[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }

    const result = [];
    for (let j = 1; j <= m; j++) {
      if (p[j] > 0 && p[j] <= n) result.push([p[j] - 1, j - 1]);
    }
    return result;
  }

  /* ═══════════════════════════════════════════════════════════════
     HELPERS
  ═══════════════════════════════════════════════════════════════ */
  function _iou(a, b) {
    const ax2 = a[0] + a[2], ay2 = a[1] + a[3];
    const bx2 = b[0] + b[2], by2 = b[1] + b[3];
    const iw = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
    const ih = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
    const inter = iw * ih;
    if (!inter) return 0;
    return inter / (a[2] * a[3] + b[2] * b[3] - inter);
  }

  function _toCenter([x, y, w, h])     { return [x + w / 2, y + h / 2, w, h]; }
  function _fromCenter([cx, cy, w, h]) { return [cx - w / 2, cy - h / 2, w, h]; }

  function _groupByIndex(arr, keyFn) {
    return arr.reduce((acc, item, i) => {
      const k = keyFn(item);
      (acc[k] = acc[k] || []).push(i);
      return acc;
    }, {});
  }

  const _COLORS = [
    '#60a5fa', '#4ade80', '#f59e0b', '#f87171', '#a78bfa',
    '#34d399', '#fb923c', '#38bdf8', '#e879f9', '#facc15',
    '#818cf8', '#2dd4bf', '#f472b6', '#a3e635', '#fb7185',
    '#22d3ee', '#fbbf24', '#c084fc', '#86efac', '#fda4af',
  ];
  function _idColor(id) { return _COLORS[(id - 1) % _COLORS.length]; }

  /* ── Expose ──────────────────────────────────────────────────── */
  window.ByteTracker = ByteTracker;
  window.SORTTracker = ByteTracker; // backward-compat alias

})();
