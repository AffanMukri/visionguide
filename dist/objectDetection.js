// ═══════════════════════════════════════════════════════════════════
//  VisionGuide — Object Detection + Tracking + Risk + Safe Direction
//
//  Full pipeline per frame:
//    1. cocoSsd.detect()           → raw detections (80 COCO classes)
//    2. ByteTracker.update()       → persistent track IDs
//    3. depthAPI.getDistanceFn()   → distance + depth zone per track
//    4. riskAPI.enrich()           → risk score + motion per track
//    5. freeSpaceAPI.analyze()     → 5×3 navigation grid
//    6. riskAPI.computeSafeDir()   → safest walking direction
//    7. Draw: free-space → bounding boxes (risk-coloured) → motion arrows
//    8. Announce: objects (risk-prioritised) + safe direction
//
//  Voice examples:
//    "Bicycle number 2 detected, approaching, close — HIGH RISK."
//    "Person number 1 detected, stationary, medium distance."
//    "Bicycle ahead, approaching fast. Move left. Left path is clear."
//
//  Exposes: window.objectDetectionAPI
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const CFG = window.VisionGuideConfig?.detection || {};
  const GUIDE_CFG = window.VisionGuideConfig?.guidance || {};

  /* ─── State ─────────────────────────────────────────────────── */
  let cocoModel    = null;
  let modelLoading = false;
  let modelLoaded  = false;
  let modelError   = null;
  let modelLoadPromise = null;

  let detectionActive   = false;
  let detectionLoop     = null;
  const DETECT_INTERVAL = CFG.intervalMs || 900;
  let runGeneration = 0;
  let frameId = 0;
  let consecutiveErrors = 0;

  let videoEl       = null;
  let overlayCanvas = null;
  let overlayCtx    = null;
  let tracker       = null;
  let latestPipelineResult = null;

  /* ─── Public API ─────────────────────────────────────────────── */
  window.objectDetectionAPI = {
    loadModel,
    startDetection,
    stopDetection,
    isModelLoaded:  () => modelLoaded,
    isModelLoading: () => modelLoading,
    getModelError:  () => modelError,
    getLatestObservation: () => window.sceneStateAPI?.getSnapshot?.() || latestPipelineResult,
    isActive: () => detectionActive,
    describeLatest,
  };

  /* ═══════════════════════════════════════════════════════════════
     MODEL LOADING
  ═══════════════════════════════════════════════════════════════ */
  async function loadModel() {
    if (modelLoaded) return cocoModel;
    if (modelLoadPromise) return modelLoadPromise;
    modelLoading = true;
    modelError = null;
    _emitBadge('od-status-badge', '⏳ Loading object detection…', 'od-badge-loading');

    modelLoadPromise = (async () => { try {
      if (!window.cocoSsd?.load) throw new Error('COCO-SSD library is unavailable');
      cocoModel    = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      modelLoaded  = true;
      modelLoading = false;
      _emitBadge('od-status-badge', '✅ ByteTrack · Risk · Safe-Dir ready', 'od-badge-ready');
      if (window.VisionGuideConfig?.debug) console.info('[VisionGuide OD] COCO-SSD ready');
      return cocoModel;
    } catch (err) {
      modelError   = err.message || 'Detection model failed';
      modelLoading = false;
      _emitBadge('od-status-badge', '⚠️ Detection unavailable', 'od-badge-error');
      if (detectionActive) {
        window.sceneStateAPI?.setStatus?.('error', modelError);
        window.guidanceAPI?.announce?.('Live visual analysis is unavailable. Do not rely on camera guidance.', {
          key: 'vision-model-unavailable', priority: 85, interrupt: true, cooldownMs: 30000
        });
      }
      return null;
    } finally { modelLoadPromise = null; }})();
    return modelLoadPromise;
  }

  /* ═══════════════════════════════════════════════════════════════
     DETECTION LOOP
  ═══════════════════════════════════════════════════════════════ */
  function startDetection(video, canvasEl) {
    if (detectionActive) {
      videoEl = video;
      overlayCanvas = canvasEl;
      overlayCtx = canvasEl ? canvasEl.getContext('2d') : null;
      if (latestPipelineResult) {
        _draw(latestPipelineResult.tracks, latestPipelineResult.freeSpace, latestPipelineResult.safeDir);
        _updatePanel(latestPipelineResult.tracks, latestPipelineResult.freeSpace, latestPipelineResult.safeDir);
      }
      return;
    }
    videoEl       = video;
    overlayCanvas = canvasEl;
    overlayCtx    = canvasEl ? canvasEl.getContext('2d') : null;
    tracker       = window.ByteTracker ? new window.ByteTracker() : null;
    latestPipelineResult = null;
    detectionActive = true;
    consecutiveErrors = 0;
    frameId = 0;
    const generation = ++runGeneration;

    if (window.riskAPI) window.riskAPI.reset();
    window.freeSpaceAPI?.reset?.();
    window.sceneStateAPI?.begin?.();

    loadModel().then(model => {
      if (model && detectionActive && generation === runGeneration) _schedule(0);
    });
  }

  function stopDetection() {
    detectionActive = false;
    runGeneration++;
    clearTimeout(detectionLoop);
    detectionLoop = null;
    if (overlayCtx && overlayCanvas)
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    _updatePanel([], null, null);
    if (tracker) { tracker.reset(); tracker = null; }
    if (window.riskAPI) window.riskAPI.reset();
    window.freeSpaceAPI?.reset?.();
    window.depthAPI?.pruneTracks?.([]);
    videoEl = null;
    overlayCanvas = null;
    overlayCtx = null;
    latestPipelineResult = null;
    window.sceneStateAPI?.reset?.();
  }

  function _schedule(delay = DETECT_INTERVAL) {
    if (!detectionActive) return;
    clearTimeout(detectionLoop);
    detectionLoop = setTimeout(_frame, delay);
  }

  /* ═══════════════════════════════════════════════════════════════
     MAIN PIPELINE
  ═══════════════════════════════════════════════════════════════ */
  async function _frame() {
    if (!detectionActive || !videoEl || !modelLoaded) { _schedule(); return; }
    if (videoEl.readyState < 2 || !videoEl.videoWidth) { _schedule(); return; }
    const generation = runGeneration;
    const frameVideo = videoEl;
    const started = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;

    try {
      // ── 1. COCO-SSD raw detections ─────────────────────────────
      _emitBadge('od-status-badge', 'Processing current scene…', 'od-badge-loading');
      const raw = await cocoModel.detect(frameVideo, CFG.maxBoxes || 20, CFG.minConfidence ?? 0.45);
      if (!detectionActive || generation !== runGeneration) return;
      if (frameVideo !== videoEl) { _schedule(0); return; }

      // ── 2. ByteTrack — persistent IDs ──────────────────────────
      const tracked = tracker
        ? tracker.update(raw)
        : raw.map((d, i) => ({ id: i+1, label: d.class, score: d.score,
            bbox: d.bbox, color: '#60a5fa' }));

      // ── 3. Depth enrichment ────────────────────────────────────
      const withDepth = _addDepth(tracked, vw, vh);
      window.depthAPI?.pruneTracks?.(tracked.map(track => track.id));

      // ── 4. Risk prioritisation ─────────────────────────────────
      const withRisk = window.riskAPI
        ? window.riskAPI.enrich(withDepth, vw, vh)
        : withDepth.map(t => ({ ...t, risk: { score: 0, level: 'low' },
            motion: { trajectory: 'unknown', approachRate: 0 } }));

      // ── 5. Free-space grid ─────────────────────────────────────
      const freeSpace = window.freeSpaceAPI
        ? window.freeSpaceAPI.analyze(videoEl, withRisk)
        : null;

      // ── 6. Safe direction ──────────────────────────────────────
      const safeDir = window.riskAPI
        ? window.riskAPI.computeSafeDir(withRisk, freeSpace, vw, vh)
        : null;

      const processingMs = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - started;
      latestPipelineResult = { tracks: withRisk, freeSpace, safeDir, time: Date.now(), videoWidth: vw, videoHeight: vh };
      window.sceneStateAPI?.publish?.({
        frameId: ++frameId, timestamp: latestPipelineResult.time, tracks: withRisk,
        freeSpace, safeDir, videoWidth: vw, videoHeight: vh, processingMs
      });

      // ── 7. Draw ────────────────────────────────────────────────
      _draw(withRisk, freeSpace, safeDir);

      // ── 8. Update panel + announce ─────────────────────────────
      _updatePanel(withRisk, freeSpace, safeDir);
      _announceScene(withRisk, safeDir, vw);
      consecutiveErrors = 0;
      _emitBadge('od-status-badge', withRisk.length ? `${withRisk.length} tracked object${withRisk.length === 1 ? '' : 's'}` : 'No tracked obstacles', 'od-badge-ready');

    } catch (err) {
      consecutiveErrors++;
      if (window.VisionGuideConfig?.debug) console.warn('[VisionGuide OD] Frame error:', err);
      _emitBadge('od-status-badge', 'Vision processing recovering…', 'od-badge-error');
      if (consecutiveErrors >= 3) {
        window.sceneStateAPI?.setStatus?.('degraded', err.message || 'Inference failed');
        window.guidanceAPI?.announce?.('Live visual analysis is temporarily unavailable. Stop and check your surroundings.', {
          key: 'vision-processing-degraded', priority: 85, interrupt: true, cooldownMs: 30000
        });
      }
    }
    _schedule(consecutiveErrors ? (CFG.errorBackoffMs || 1800) : DETECT_INTERVAL);
  }

  /* ═══════════════════════════════════════════════════════════════
     DEPTH ENRICHMENT
  ═══════════════════════════════════════════════════════════════ */
  function _addDepth(tracks, vw, vh) {
    return tracks.map(t => ({
      ...t,
      distInfo: window.depthAPI
        ? window.depthAPI.getDistanceForBBox(t.bbox, vw, vh, t.id)
        : null,
    }));
  }

  /* ═══════════════════════════════════════════════════════════════
     CANVAS DRAWING
     Order: free-space tints → bounding boxes → motion arrows
  ═══════════════════════════════════════════════════════════════ */
  function _draw(tracks, freeSpace, safeDir) {
    if (!overlayCtx || !overlayCanvas || !videoEl) return;

    const dw = videoEl.offsetWidth  || videoEl.videoWidth;
    const dh = videoEl.offsetHeight || videoEl.videoHeight;
    overlayCanvas.width  = dw;
    overlayCanvas.height = dh;
    overlayCtx.clearRect(0, 0, dw, dh);

    // Layer 1 — free-space overlay (tinted cells + ribbon + arrow)
    if (freeSpace && window.freeSpaceAPI) {
      // Pass safeDir so the risk-based direction overrides ribbon/arrow
      const overlayDir = safeDir ? {
        lClear:    (safeDir.zones?.left?.freePct ?? 0) >= 65 && safeDir.zones?.left?.riskLevel !== 'high',
        cClear:    (safeDir.zones?.center?.freePct ?? 0) >= 65 && safeDir.zones?.center?.riskLevel !== 'high',
        rClear:    (safeDir.zones?.right?.freePct ?? 0) >= 65 && safeDir.zones?.right?.riskLevel !== 'high',
        direction: _toFreeSpaceDir(safeDir.direction),
        summary:   safeDir.speech,
      } : null;
      window.freeSpaceAPI.drawOverlay(overlayCtx, freeSpace, dw, dh, overlayDir);
    }

    // Layer 2 — bounding boxes (coloured by risk level)
    if (tracks && tracks.length) {
      const sx = dw / videoEl.videoWidth;
      const sy = dh / videoEl.videoHeight;
      // Draw lowest risk first so HIGH risk always renders on top
      [...tracks].reverse().forEach(t => _drawBox(t, sx, sy, dw, dh));
    }
  }

  // Map riskAPI direction strings to freeSpaceAnalyzer direction strings
  function _toFreeSpaceDir(d) {
    return { center: 'forward', left: 'left', right: 'right', stop: 'stop' }[d] || 'slow';
  }

  /* ── Single bounding box ──────────────────────────────────────── */
  function _drawBox(t, sx, sy, dw, dh) {
    const [x, y, w, h] = t.bbox;
    const dx = x*sx, dy = y*sy, bw = w*sx, bh = h*sy;
    const risk  = t.risk?.level || 'low';
    const color = _riskColor(risk, t.color);
    const glow  = { high: 18, medium: 10, low: 7 }[risk];
    const thick = { high: 3.5, medium: 2.5, low: 2 }[risk];

    // Glowing box
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth   = thick;
    overlayCtx.shadowColor = color + 'bb';
    overlayCtx.shadowBlur  = glow;
    overlayCtx.beginPath();
    overlayCtx.roundRect(dx, dy, bw, bh, 6);
    overlayCtx.stroke();
    overlayCtx.shadowBlur = 0;

    // Corner brackets
    _drawCorners(dx, dy, bw, bh, color);

    // Motion arrow (top-right corner of box)
    if (t.motion && t.motion.trajectory !== 'unknown') {
      _drawMotionArrow(dx + bw, dy, t.motion, color);
    }

    // Label pill
    _drawLabel(t, dx, dy, bw, bh, color, dw, dh);
  }

  function _riskColor(level, fallback) {
    return { high: '#f87171', medium: '#facc15', low: fallback || '#4ade80' }[level] || fallback;
  }

  /* ── Corner brackets ──────────────────────────────────────────── */
  function _drawCorners(x, y, w, h, color) {
    const len = Math.min(14, w*0.2, h*0.2);
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth   = 2.5;
    [
      [[x,y+len],[x,y],[x+len,y]],
      [[x+w-len,y],[x+w,y],[x+w,y+len]],
      [[x,y+h-len],[x,y+h],[x+len,y+h]],
      [[x+w-len,y+h],[x+w,y+h],[x+w,y+h-len]],
    ].forEach(pts => {
      overlayCtx.beginPath();
      overlayCtx.moveTo(...pts[0]);
      overlayCtx.lineTo(...pts[1]);
      overlayCtx.lineTo(...pts[2]);
      overlayCtx.stroke();
    });
  }

  /* ── Motion direction arrow ───────────────────────────────────── */
  function _drawMotionArrow(px, py, motion, color) {
    const ARROWS = {
      'approaching':     '▼', // growing = coming toward camera
      'receding':        '▲',
      'crossing-left':   '◀',
      'crossing-right':  '▶',
      'stationary':      '●',
    };
    const symbol = ARROWS[motion.trajectory];
    if (!symbol) return;

    const sz = 16;
    overlayCtx.globalAlpha = 0.9;
    overlayCtx.fillStyle   = color;
    overlayCtx.beginPath();
    overlayCtx.roundRect(px - sz - 2, py + 2, sz, sz, 3);
    overlayCtx.fill();

    overlayCtx.fillStyle  = '#000';
    overlayCtx.font       = 'bold 10px Inter, system-ui, sans-serif';
    overlayCtx.textAlign  = 'center';
    overlayCtx.fillText(symbol, px - sz/2 - 2, py + sz - 3);
    overlayCtx.textAlign  = 'left';
    overlayCtx.globalAlpha = 1;
  }

  /* ── Label pill ───────────────────────────────────────────────── */
  function _drawLabel(t, dx, dy, bw, bh, color, dw, dh) {
    const risk     = t.risk?.level || 'low';
    const riskTag  = risk === 'high' ? '🔴 HIGH' : risk === 'medium' ? '🟡 MED' : '🟢 LOW';
    const name     = `${_cap(t.label)} #${t.id}`;
    const distText = t.distInfo ? `📏 ${t.distInfo.detail}` : `${Math.round(t.score*100)}%`;

    overlayCtx.font = 'bold 12px Inter, system-ui, sans-serif';
    const tw = Math.max(
      overlayCtx.measureText(riskTag + '  ' + name).width,
      overlayCtx.measureText(distText).width,
    ) + 16;
    const th = 48;

    const lx = Math.min(Math.max(dx - 1, 0), dw - tw - 2);
    const ly = dy > th + 4 ? dy - th - 4 : Math.min(dy + bh + 4, dh - th - 2);

    // Pill background
    overlayCtx.globalAlpha = 0.93;
    overlayCtx.fillStyle   = color;
    overlayCtx.beginPath();
    overlayCtx.roundRect(lx, ly, tw, th, 7);
    overlayCtx.fill();
    overlayCtx.globalAlpha = 1;

    // Risk level text (top line)
    overlayCtx.fillStyle = '#000';
    overlayCtx.font      = 'bold 11px Inter, system-ui, sans-serif';
    overlayCtx.fillText(riskTag, lx + 5, ly + 14);

    // Object name
    overlayCtx.font = 'bold 12px Inter, system-ui, sans-serif';
    overlayCtx.fillText(name, lx + 5, ly + 28);

    // Distance
    overlayCtx.font = '11px Inter, system-ui, sans-serif';
    overlayCtx.fillText(distText, lx + 5, ly + 43);
  }

  /* ═══════════════════════════════════════════════════════════════
     SIDE PANEL
  ═══════════════════════════════════════════════════════════════ */
  function _updatePanel(tracks, freeSpace, safeDir) {
    const el = document.getElementById('od-detected-list');
    if (!el) return;

    // ── Zone analysis row ──────────────────────────────────────────
    let zoneHtml = '';
    if (safeDir?.zones) {
      const z = safeDir.zones;
      const dirLabel = { center:'▲ Forward', left:'↖ Left', right:'↗ Right' };
      zoneHtml = `
        <div class="od-zone-analysis">
          <div class="oz-bar">
            ${_zoneCell('left',   z.left)}
            ${_zoneCell('center', z.center)}
            ${_zoneCell('right',  z.right)}
          </div>
          <div class="oz-advice">
            <span class="oz-dir-chip oz-dir-${safeDir.direction}">
              ${dirLabel[safeDir.direction] || '▲ Forward'}
            </span>
            <span class="oz-speech">${safeDir.speech}</span>
          </div>
        </div>`;
    } else if (freeSpace?.advice) {
      // Fallback to simple freeSpace advice
      const a = freeSpace.advice;
      zoneHtml = `<div class="od-nav-row">
        <span class="od-nav-dir od-nav-${a.direction}">${_dirIcon(a.direction)} ${a.summary}</span>
        <span class="od-nav-side ${a.lClear?'od-nav-clear':'od-nav-block'}">L</span>
        <span class="od-nav-side ${a.cClear?'od-nav-clear':'od-nav-block'}">C</span>
        <span class="od-nav-side ${a.rClear?'od-nav-clear':'od-nav-block'}">R</span>
      </div>`;
    }

    // ── Risk-sorted track tags ─────────────────────────────────────
    if (!tracks || !tracks.length) {
      el.innerHTML = zoneHtml + '<span class="od-empty">Scanning… point camera at objects</span>';
      return;
    }

    const tagsHtml = tracks.map(t => {
      const risk  = t.risk?.level || 'low';
      const zone  = t.distInfo?.zone || 'medium';
      const mot   = t.motion?.trajectory || 'unknown';
      const color = _riskColor(risk, t.color);
      return `<span class="od-tag od-tag-risk-${risk}" style="border-color:${color}">
        <span class="od-risk-dot od-risk-${risk}"></span>
        <span class="od-tag-name">${_cap(t.label)}</span>
        <span class="od-track-id">#${t.id}</span>
        ${mot !== 'unknown' ? `<span class="od-motion-tag od-mot-${mot}">${_motLabel(mot)}</span>` : ''}
        ${t.distInfo ? `<span class="od-dist-pill od-dist-${zone}">${t.distInfo.label}</span>` : ''}
        <span class="od-risk-badge od-risk-badge-${risk}">${risk.toUpperCase()}</span>
      </span>`;
    }).join('');

    el.innerHTML = zoneHtml + tagsHtml;
    _refreshDepthBadge();
  }

  function _zoneCell(key, zone) {
    if (!zone) return '';
    const level = zone.riskLevel || 'low';
    const free  = zone.freePct ?? 50;
    const label = { left: '← Left', center: 'Center', right: 'Right →' }[key];
    const emoji = { low:'✅', medium:'⚠️', high:'⛔' }[level];
    return `<span class="oz-cell oz-cell-${level}">
      <span class="oz-cell-label">${label}</span>
    <span class="oz-cell-free">${free}% estimated open</span>
      <span class="oz-cell-risk">${emoji} ${level}</span>
    </span>`;
  }

  /* ═══════════════════════════════════════════════════════════════
     GUIDANCE — one prioritised scene message, never competing voices
  ═══════════════════════════════════════════════════════════════ */
  function _announceScene(tracks, safeDir, videoWidth) {
    if (!safeDir || !window.riskAPI?.shouldAnnounceDir?.(safeDir.direction)) return;
    const highest = tracks?.[0];
    const highRisk = highest?.risk?.level === 'high';
    const urgent = highRisk || safeDir.direction === 'stop';
    const centre = highest ? (highest.bbox[0] + highest.bbox[2] / 2) / videoWidth : 0.5;
    const side = centre < 0.38 ? 'on your left' : centre > 0.62 ? 'on your right' : 'ahead';
    const approaching = highest?.motion?.trajectory === 'approaching';
    let text = safeDir.speech;
    if (highRisk && !text.toLowerCase().includes(highest.label)) {
      text = `${_cap(highest.label)} ${side}${approaching ? ', approaching' : ''}. ${text}`;
    }
    const priority = urgent ? 100 : highest?.risk?.level === 'medium' ? 85 : 30;
    const key = urgent
      ? `risk:${highest?.id || 'scene'}:${highest?.risk?.level || 'blocked'}:${highest?.distInfo?.zone || 'unknown'}:${highest?.motion?.trajectory || 'unknown'}`
      : `direction:${safeDir.direction}:${highest?.risk?.level || 'clear'}`;
    window.riskAPI.markDirSent(safeDir.direction);
    if (window.guidanceAPI) {
      window.guidanceAPI.announce(text, {
        key,
        priority,
        interrupt: urgent,
        cooldownMs: urgent ? (GUIDE_CFG.objectCooldownMs || 9000) : (GUIDE_CFG.directionCooldownMs || 6500)
      });
    } else if (typeof speak === 'function') speak(text);
  }

  /* ═══════════════════════════════════════════════════════════════
     HELPERS
  ═══════════════════════════════════════════════════════════════ */
  function _emitBadge(id, text, cls) {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.className = `od-status-badge ${cls}`; }
  }

  function _refreshDepthBadge() {
    const badge = document.getElementById('depth-status-badge');
    if (!badge || !window.depthAPI) return;
    if (window.depthAPI.isLoaded()) {
      const age = window.depthAPI.getDepthAge();
      badge.textContent = Number.isFinite(age) ? (age < 6000 ? 'Depth model active' : `Depth map · ${Math.round(age/1000)}s old`) : 'Depth model ready · awaiting frame';
      badge.className = 'depth-status-badge depth-badge-ready';
    }
  }

  function _cap(s)     { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
  function _dirIcon(d) { return {forward:'▲',left:'↖',right:'↗',split:'↕',stop:'⛔',slow:'⚠️'}[d]||'▲'; }

  function _motLabel(t) {
    return {
      'approaching':    '↓ nearing',
      'receding':       '↑ moving away',
      'crossing-left':  '◀ crossing',
      'crossing-right': '▶ crossing',
      'stationary':     '● still',
    }[t] || '';
  }
  function _motSpeech(t) {
    return {
      'approaching':    'approaching',
      'receding':       'moving away',
      'crossing-left':  'crossing left',
      'crossing-right': 'crossing right',
      'stationary':     'stationary',
    }[t] || '';
  }

  /* A concise, on-demand scene description for the voice command layer. */
  function describeLatest() {
    const observation = window.sceneStateAPI?.getSnapshot?.();
    if (!observation || observation.status !== 'active' || Date.now() - observation.timestamp > (CFG.staleAfterMs || 5000)) return '';
    const objects = [...observation.objects].sort((a,b) => b.riskScore - a.riskScore);
    if (!objects.length) {
      return observation.guidanceMessage || 'No tracked obstacle is detected ahead. Continue carefully.';
    }
    const descriptions = objects.slice(0,3).map(object => {
      const side = object.position === 'left' ? 'on your left' : object.position === 'right' ? 'on your right' : 'ahead';
      const movement = _motSpeech(object.motion);
      return `${_cap(object.class)} ${side}, ${object.distanceLabel}${movement ? `, ${movement}` : ''}`;
    });
    const guidance = observation.guidanceMessage ? ` ${observation.guidanceMessage}` : '';
    return `${descriptions.join('. ')}.${guidance}`;
  }

})();
