// ═══════════════════════════════════════════════════════════════════
//  VisionGuide — Risk Engine + Safe Direction Module
//
//  FEATURE 1: Risk Prioritisation
//  ─────────────────────────────
//  Takes per-track data (class, confidence, bbox, track ID, depth,
//  movement history) and computes a numeric risk score + level.
//
//  Risk = distance_weight
//       + object_type_danger
//       + trajectory_score        (approaching/receding/crossing)
//       + closing_speed_bonus
//       + screen_position_weight  (centre = highest risk)
//       + vertical_position       (bottom = in walking path)
//       × confidence_factor
//
//  Output per track:
//    { risk: { score: 82, level: 'high' },
//      motion: { trajectory: 'approaching', closingSpeed: 0.24, vx, vy } }
//
//  FEATURE 2: Safe Direction Guidance
//  ────────────────────────────────────
//  Divides the frame into LEFT | CENTER | RIGHT zones.
//  Each zone scored by:
//    freePct (% clear cells from freeSpaceAPI grid)
//    - maxRisk  (highest risk track in zone × weight)
//    - approaching penalty
//    - closest depth penalty
//
//  Final output:
//    { direction: 'left', speech: 'Obstacle ahead. Move slightly left.',
//      zones: { left:{freePct,maxRisk,safetyScore}, … } }
//
//  Exposes: window.riskAPI
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const CFG = window.VisionGuideConfig?.risk || {};

  /* ─── Motion history ─────────────────────────────────────────── */
  const _hist   = new Map();  // trackId → [{area, cx, cy, time}, …]
  const HIST_N  = CFG.historyFrames || 6;
  const HIST_MS = CFG.historyMs || 8000;

  /* ─── Safe-direction announcement throttle ───────────────────── */
  let _prevDir     = null;
  let _prevDirTime = 0;
  let _stableDir = null;
  let _candidateDir = null;
  let _candidateFrames = 0;
  const DIR_REPEAT = CFG.directionRepeatMs || 7000;
  const DIR_CHANGE = 1200;

  /* ─── Public API ─────────────────────────────────────────────── */
  window.riskAPI = {
    enrich,           // (tracks, videoW, videoH) → enriched + sorted tracks
    computeSafeDir,   // (enrichedTracks, freeSpaceResult, videoW, videoH) → guidance
    shouldAnnounceDir,
    markDirSent,
    reset: () => {
      _hist.clear(); _prevDir = null; _prevDirTime = 0;
      _stableDir = null; _candidateDir = null; _candidateFrames = 0;
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     FEATURE 1 — RISK PRIORITISATION
  ═══════════════════════════════════════════════════════════════ */

  /**
   * Enrich tracks with motion analysis and risk score.
   * Returns tracks sorted highest → lowest risk.
   */
  function enrich(tracks, videoW, videoH) {
    const now = Date.now();
    // Prune dead tracks from history
    const activeIds = new Set((tracks || []).map(t => t.id));
    for (const id of _hist.keys()) {
      if (!activeIds.has(id)) _hist.delete(id);
    }
    if (!tracks || !tracks.length) return [];

    return tracks
      .map(track => {
        const [bx, by, bw, bh] = track.bbox;
        const area = bw * bh;
        const cx   = bx + bw / 2;
        const cy   = by + bh / 2;

        // Append to per-track history
        const h = _hist.get(track.id) || [];
        h.push({ area, cx, cy, time: now });
        // Trim by count and age
        const cutoff = now - HIST_MS;
        while (h.length > HIST_N || (h.length > 1 && h[0].time < cutoff)) h.shift();
        _hist.set(track.id, h);

        const motion = _analyseMotion(h, videoW, videoH);
        const risk   = _score(track, motion, cx, cy, videoW, videoH);
        return { ...track, motion, risk };
      })
      .sort((a, b) => b.risk.score - a.risk.score); // highest risk first
  }

  /* ── Motion analysis ──────────────────────────────────────────── */
  function _analyseMotion(h, videoW, videoH) {
    if (h.length < 2) {
      return { trajectory: 'unknown', approachRate: 0, vx: 0, vy: 0 };
    }

    const old = h[0];
    const cur = h[h.length - 1];
    const dt  = Math.max(0.1, (cur.time - old.time) / 1000); // seconds

    // Approach rate: relative bounding-box area growth per second
    const areaRatio   = (cur.area - old.area) / Math.max(1, old.area);
    const approachRate = areaRatio / dt;

    // Normalised pixel velocity (0–1 scale)
    const vx = (cur.cx - old.cx) / dt / videoW;
    const vy = (cur.cy - old.cy) / dt / videoH;

    let trajectory;
    if (approachRate > 0.07)        trajectory = 'approaching';
    else if (approachRate < -0.07)  trajectory = 'receding';
    else if (Math.abs(vx) > 0.04)  trajectory = vx < 0 ? 'crossing-left' : 'crossing-right';
    else                            trajectory = 'stationary';

    return { trajectory, approachRate, vx, vy };
  }

  /* ── Risk score ───────────────────────────────────────────────── */

  // Inherent danger factor per COCO-SSD class
  const TYPE_PTS = {
    // Vehicles — catastrophic if approaching
    train: 32, car: 28, truck: 28, bus: 26, motorcycle: 26, bicycle: 24,
    // Animals/people
    person: 20, dog: 18, horse: 16, cow: 14, sheep: 10, cat: 8,
    // Stationary hazards
    chair: 12, 'dining table': 12, bench: 12, sofa: 10, bed: 10,
    skateboard: 16, suitcase: 13, backpack: 9, umbrella: 8,
    // Low risk items
    bottle: 5, cup: 4, book: 3, laptop: 7, 'cell phone': 4, keyboard: 4,
    vase: 6, 'potted plant': 6,
  };
  const DEFAULT_TYPE = 6;

  function _score(track, motion, cx, cy, videoW, videoH) {
    let s = 0;

    // ─ Factor 1: Distance / depth zone (0–40 pts) ─────────────────
    const depthPoints = { danger: 40, close: 28, medium: 14, far: 4 }[track.distInfo?.zone] ?? 18;
    s += track.distInfo?.uncertain ? depthPoints * 0.65 : depthPoints;

    // ─ Factor 2: Object type danger (0–32 pts) ────────────────────
    s += TYPE_PTS[track.label] ?? DEFAULT_TYPE;

    // ─ Factor 3: Trajectory (0–28 pts) ────────────────────────────
    s += {
      approaching:      28,
      'crossing-left':  14,
      'crossing-right': 14,
      stationary:        5,
      receding:          0,
      unknown:           7,
    }[motion.trajectory] ?? 7;

    // Bonus for fast approach
    if (motion.approachRate > 0.30)      s += 12;
    else if (motion.approachRate > 0.15) s += 6;

    // ─ Factor 4: Horizontal centrality (0–10 pts) ─────────────────
    // Centred in frame = higher collision risk
    const normX = cx / videoW;
    const fromCentre = Math.abs(normX - 0.5) * 2; // 0=centre, 1=edge
    s += Math.round((1 - fromCentre) * 10);

    // ─ Factor 5: Vertical ground-plane position (0–8 pts) ─────────
    // Low in frame = nearer the walking surface
    s += Math.round((cy / videoH) * 8);

    // ─ Confidence weight (quality of detection) ───────────────────
    s = Math.round(s * (0.55 + track.score * 0.45));

    const level = s >= (CFG.highThreshold || 68) ? 'high' : s >= (CFG.mediumThreshold || 38) ? 'medium' : 'low';
    return { score: s, level };
  }

  /* ═══════════════════════════════════════════════════════════════
     FEATURE 2 — SAFE DIRECTION GUIDANCE
  ═══════════════════════════════════════════════════════════════ */

  /**
   * Divides frame into LEFT | CENTER | RIGHT and scores each zone.
   * Returns the safest direction + speech.
   */
  function computeSafeDir(enrichedTracks, freeSpaceResult, videoW, videoH) {
    // Zone definitions: {colRange} = grid columns from freeSpaceAnalyzer (0-4)
    const ZONES = {
      left:   { label: 'Left',   colRange: [0, 2], xRange: [0,         videoW / 3]     },
      center: { label: 'Center', colRange: [2, 3], xRange: [videoW / 3, videoW * 2/3]  },
      right:  { label: 'Right',  colRange: [3, 5], xRange: [videoW * 2/3, videoW]      },
    };

    // ── Populate zones ───────────────────────────────────────────
    for (const [, zone] of Object.entries(ZONES)) {
      const [xMin, xMax] = zone.xRange;

      // Tracks in this zone (by centre-x)
      zone.tracks = (enrichedTracks || []).filter(t => {
        const cx = t.bbox[0] + t.bbox[2] / 2;
        return cx >= xMin && cx < xMax;
      });

      // Free area % from freeSpaceAPI grid
      if (freeSpaceResult?.grid) {
        const [c0, c1] = zone.colRange;
        const cells = freeSpaceResult.grid.filter(c => c.c >= c0 && c.c < c1);
        const weights = cells.map(c => ({ cell:c, weight:c.r === 2 ? 3 : c.r === 1 ? 2 : 1 }));
        const totalWeight = weights.reduce((sum,item)=>sum+item.weight,0);
        const freeWeight = weights.reduce((sum,item)=>sum+(1-(item.cell.occupancy ?? (item.cell.status==='clear'?0:1)))*item.weight,0);
        zone.freePct = totalWeight ? Math.round(freeWeight/totalWeight*100) : 50;
      } else {
        zone.freePct = 50; // assume half clear if no grid
      }

      // Aggregate risk metrics
      zone.maxRisk  = zone.tracks.length
        ? Math.max(...zone.tracks.map(t => t.risk.score))
        : 0;
      zone.riskLevel = zone.maxRisk >= (CFG.highThreshold || 68) ? 'high'
                     : zone.maxRisk >= (CFG.mediumThreshold || 38) ? 'medium' : 'low';
      zone.hasApproach = zone.tracks.some(t =>
        t.motion?.trajectory === 'approaching'
      );
      zone.closestDepth = _closestDepth(zone.tracks);

      // ── Zone safety score (higher = safer) ─────────────────────
      // freePct baseline (0–100)
      // minus risk penalties
      zone.safetyScore =
          zone.freePct
        - (zone.maxRisk * 0.55)
        - (zone.hasApproach ? 28 : 0)
        - ({ danger: 35, close: 22, medium: 8, far: 0 }[zone.closestDepth] ?? 0);
    }

    // ── Choose direction ─────────────────────────────────────────
    const sorted = Object.entries(ZONES).sort(([,a],[,b]) => b.safetyScore - a.safetyScore);
    const [bestKey, bestZone] = sorted[0];

    // Prefer going straight if centre is within 12 pts of best
    const centreSafe = ZONES.center.safetyScore >= bestZone.safetyScore - (CFG.directionMargin || 12);
    const allBlocked = Object.values(ZONES).every(zone => zone.freePct < (CFG.blockedFreePercent ?? 35));
    const rawDir = allBlocked ? 'stop' : centreSafe ? 'center' : bestKey;
    const finalDir = _stabilizeDirection(rawDir, ZONES);

    const speech = _buildSpeech(finalDir, ZONES);
    const orderedScores = Object.values(ZONES).map(z=>z.safetyScore).sort((a,b)=>b-a);
    const confidence = Math.max(0, Math.min(1, ((orderedScores[0]||0)-(orderedScores[1]||0))/35));
    return { direction: finalDir, rawDirection: rawDir, speech, zones: ZONES, confidence };
  }

  function _stabilizeDirection(rawDir, zones) {
    if (rawDir === 'stop') {
      _stableDir = 'stop'; _candidateDir = null; _candidateFrames = 0;
      return _stableDir;
    }
    if (!_stableDir) { _stableDir = rawDir; return _stableDir; }
    if (rawDir === _stableDir) {
      _candidateDir = null; _candidateFrames = 0;
      return _stableDir;
    }
    const improvement = _stableDir === 'stop' ? Infinity : zones[rawDir].safetyScore - zones[_stableDir].safetyScore;
    const urgent = zones.center.riskLevel === 'high' && _stableDir === 'center' && rawDir !== 'center';
    if (!urgent && improvement < (CFG.directionSwitchMargin || 10)) {
      _candidateDir = null; _candidateFrames = 0;
      return _stableDir;
    }
    if (_candidateDir === rawDir) _candidateFrames++;
    else { _candidateDir = rawDir; _candidateFrames = 1; }
    if (urgent || _candidateFrames >= (CFG.directionConfirmFrames || 2)) {
      _stableDir = rawDir; _candidateDir = null; _candidateFrames = 0;
    }
    return _stableDir;
  }

  function _closestDepth(tracks) {
    const order = { danger: 0, close: 1, medium: 2, far: 3 };
    return tracks.reduce((best, t) => {
      const z = t.distInfo?.zone || 'medium';
      return (order[z] ?? 2) < (order[best] ?? 2) ? z : best;
    }, 'far');
  }

  function _buildSpeech(dir, zones) {
    const cZ       = zones.center;
    const highObjs = cZ.tracks.filter(t => t.risk.level === 'high');
    const medObjs  = cZ.tracks.filter(t => t.risk.level !== 'low');

    if (dir === 'stop') return 'Obstacle patterns are detected across the view. Stop and check your surroundings.';

    const noTrackedObjects = !cZ.tracks.length && !zones.left.tracks.length && !zones.right.tracks.length;
    const hasGridAlert = Object.values(zones).some(zone => zone.freePct < 85);

    // No supported detections or depth-grid anomalies anywhere
    if (noTrackedObjects && !hasGridAlert) {
      return 'No tracked obstacle is detected ahead. Continue carefully.';
    }

    if (noTrackedObjects) {
      if (dir === 'left' || dir === 'right') return `An obstacle pattern is detected ahead. The ${dir} side appears clearer.`;
      return 'An unclassified obstacle pattern may be ahead. Proceed with caution.';
    }

    // Centre safe enough
    if (dir === 'center') {
      if (!cZ.tracks.length) return 'No tracked obstacle is in the centre. Continue carefully.';
      if (highObjs.length) return 'High-risk obstacle nearby. Proceed with caution.';
      return 'Centre path is safest. Proceed carefully.';
    }

    const dirWord = dir === 'left' ? 'left' : 'right';

    // High risk in centre
    if (highObjs.length) {
      const name = _cap(highObjs[0].label);
      const mot  = highObjs[0].motion?.trajectory;
      const motWord = mot === 'approaching' ? ', approaching fast' : '';
      return `${name} ahead${motWord} — high risk. Move ${dirWord}. The ${dirWord} side appears clearer.`;
    }

    // Medium risk in centre
    if (medObjs.length) {
      return `Obstacle ahead. Move slightly ${dirWord}. The ${dirWord} path appears safer.`;
    }

    // Centre clear but other zones are safer
    return `${dir === 'left' ? 'Left' : 'Right'} path appears clearest. Move slightly ${dirWord}.`;
  }

  /* ── Announcement throttle ────────────────────────────────────── */
  function shouldAnnounceDir(dir) {
    const now = Date.now(), e = now - _prevDirTime;
    if (dir !== _prevDir && e > DIR_CHANGE) return true;
    if (dir === _prevDir && e > DIR_REPEAT)  return true;
    return false;
  }
  function markDirSent(dir) { _prevDir = dir; _prevDirTime = Date.now(); }

  /* ─── Helpers ────────────────────────────────────────────────── */
  function _cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

})();
