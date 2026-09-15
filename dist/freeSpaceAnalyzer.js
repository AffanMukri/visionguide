// ═══════════════════════════════════════════════════════════════════
//  VisionGuide — Free-Space / Safe Walking Area Analyzer
//
//  Inspired by YOLOP (drivable-area segmentation) adapted for
//  pedestrian navigation — no extra AI model needed.
//
//  Two obstacle sources fused into a 5×3 navigation grid:
//    1. ByteTrack detections  → named obstacles (person, chair …)
//    2. Depth-Anything-V2     → floor deviation → undetected objects
//
//  Visual outputs drawn on the existing od-overlay-canvas:
//    • Semi-transparent cell tints  (green=no alert, yellow=caution, red=obstacle)
//    • Navigation ribbon at bottom  (Left | Center | Right status)
//    • Direction arrow              (↑ forward, ↗ right, ↖ left, ✗ stop)
//
//  Voice outputs (separate from object detection speech):
//    "No tracked obstacle is ahead. Continue carefully."
//    "Obstacle directly ahead. The left side appears clearer."
//    "Path blocked on all sides. Please stop."
//
//  Exposes: window.freeSpaceAPI
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const CFG = window.VisionGuideConfig?.freeSpace || {};

  /* ─── Grid config ────────────────────────────────────────────── */
  const COLS = CFG.columns || 5;
  const ROWS = CFG.rows || 3;

  /* ─── Thresholds ─────────────────────────────────────────────── */
  // Detected bbox must cover ≥ this fraction of a cell to mark it obstacle
  const DET_OVERLAP  = CFG.detectionOverlap ?? 0.20;
  let _smoothedCells = [];

  /* ─── Announcement throttle ──────────────────────────────────── */
  let _prevSig       = '';
  let _prevSigTime   = 0;
  const REPEAT_CD    = 5000;  // re-announce identical advice after 5 s
  const CHANGE_CD    = 1500;  // announce changed advice after 1.5 s

  /* ─── Public API ─────────────────────────────────────────────── */
  window.freeSpaceAPI = {
    analyze,
    drawOverlay,
    shouldAnnounce,
    markSent,
    reset: () => { _smoothedCells = []; _prevSig = ''; _prevSigTime = 0; },
  };

  /* ═══════════════════════════════════════════════════════════════
     MAIN ANALYSIS  (called each detection frame)
  ═══════════════════════════════════════════════════════════════ */
  /**
   * @param {HTMLVideoElement} videoEl  — live camera video
   * @param {Array}            tracks   — enriched ByteTrack output
   * @returns {{ grid, advice, COLS, ROWS }} | null
   */
  function analyze(videoEl, tracks) {
    if (!videoEl || videoEl.videoWidth === 0) return null;

    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;

    const grid = _buildGrid(vw, vh);

    // ── Source 1: ByteTrack bounding boxes ────────────────────────
    if (tracks && tracks.length) _applyDetections(grid, tracks, vw, vh);

    // ── Source 2: Depth-Anything-V2 floor deviation ───────────────
    const dm = window.depthAPI?.getDepthMap?.();
    if (dm && dm.data) _applyDepth(grid, dm, vw, vh);

    const smoothedGrid = _smoothGrid(grid);
    const advice = _computeAdvice(smoothedGrid);
    return { grid: smoothedGrid, advice, COLS, ROWS };
  }

  /* ═══════════════════════════════════════════════════════════════
     GRID CONSTRUCTION
  ═══════════════════════════════════════════════════════════════ */
  function _buildGrid(vw, vh) {
    const cells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        cells.push({
          r, c,
          x: (c / COLS) * vw,  y: (r / ROWS) * vh,
          w: vw / COLS,        h: vh / ROWS,
          status: 'clear',    // 'clear' | 'caution' | 'obstacle'
          zone:   null,        // 'danger' | 'close' | 'medium' | 'far'
          src:    null,        // 'det' | 'depth'
          label:  null,
          trackId: null,
        });
      }
    }
    return cells;
  }

  /* ═══════════════════════════════════════════════════════════════
     SOURCE 1 — ByteTrack detection overlaps
  ═══════════════════════════════════════════════════════════════ */
  function _applyDetections(grid, tracks, vw, vh) {
    tracks.forEach(track => {
      const [bx, by, bw, bh] = track.bbox;
      const zone = track.distInfo?.zone || 'medium';
      const w  = _zoneWeight(zone);

      grid.forEach(cell => {
        // Don't downgrade existing high-priority obstacle
        if (cell.status === 'obstacle' && _zoneWeight(cell.zone) >= w) return;

        const ix1 = Math.max(bx, cell.x);
        const iy1 = Math.max(by, cell.y);
        const ix2 = Math.min(bx + bw, cell.x + cell.w);
        const iy2 = Math.min(by + bh, cell.y + cell.h);
        const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);

        if (inter / (cell.w * cell.h) >= DET_OVERLAP) {
          cell.status  = 'obstacle';
          cell.zone    = zone;
          cell.src     = 'det';
          cell.label   = track.label;
          cell.trackId = track.id;
        }
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     SOURCE 2 — Depth-based floor deviation
     The ground plane in a forward-facing camera has a characteristic
     depth gradient. Anything significantly CLOSER than the local
     floor baseline is an elevated object = obstacle.
  ═══════════════════════════════════════════════════════════════ */
  function _applyDepth(grid, dm, vw, vh) {
    const { data, width: dw, height: dh } = dm;
    const range = dm.sceneMax - dm.sceneMin;
    if (!data?.length || !dw || !dh || range < 1e-6) return;

    // Depth Anything supplies relative inverse depth (larger = closer). Compare
    // each cell with peers in the same image row; this avoids claiming that the
    // bottom of an arbitrarily aimed camera is guaranteed to be floor.
    const cellDepth = grid.map(cell => _cellMedian(data, dw, dh, cell));
    const rowBaseline = Array.from({ length: ROWS }, (_, row) => {
      const values = grid.filter(cell => cell.r === row).map(cell => cellDepth[cell.r * COLS + cell.c]);
      return _median(values);
    });

    grid.forEach((cell, index) => {
      if (cell.status === 'obstacle') return;
      const normalizedDelta = (cellDepth[index] - rowBaseline[cell.r]) / range;
      if (normalizedDelta >= (CFG.depthObstacleDelta ?? 0.24)) {
        const closeness = (cellDepth[index] - dm.sceneMin) / range;
        cell.status = 'obstacle';
        cell.zone = closeness >= 0.78 ? 'danger' : closeness >= 0.58 ? 'close' : 'medium';
        cell.src = 'depth';
      } else if (normalizedDelta >= (CFG.depthCautionDelta ?? 0.12)) {
        cell.status = 'caution';
        cell.src = 'depth';
      }
    });
  }

  function _cellMedian(data, dw, dh, cell) {
    const x1 = Math.floor(cell.c / COLS * dw), x2 = Math.max(x1 + 1, Math.floor((cell.c + 1) / COLS * dw));
    const y1 = Math.floor(cell.r / ROWS * dh), y2 = Math.max(y1 + 1, Math.floor((cell.r + 1) / ROWS * dh));
    const stepX = Math.max(1, Math.floor((x2-x1)/12));
    const stepY = Math.max(1, Math.floor((y2-y1)/8));
    const values = [];
    for (let y=y1; y<y2; y+=stepY) for (let x=x1; x<x2; x+=stepX) {
      const value=data[y*dw+x]; if (Number.isFinite(value)) values.push(value);
    }
    return _median(values);
  }

  function _median(values) {
    if (!values.length) return 0;
    values.sort((a,b)=>a-b);
    return values[Math.floor(values.length/2)];
  }

  function _smoothGrid(grid) {
    const alpha = CFG.smoothing ?? 0.55;
    return grid.map((cell, index) => {
      const current = cell.status === 'obstacle' ? 1 : cell.status === 'caution' ? 0.5 : 0;
      const previous = _smoothedCells[index];
      // Raise new hazards immediately; smooth only the decay to reduce flicker.
      const severity = !previous || current > previous.severity
        ? current
        : previous.severity * (1-alpha) + current * alpha;
      const status = severity >= (CFG.obstacleThreshold ?? 0.62) ? 'obstacle'
        : severity >= (CFG.cautionThreshold ?? 0.26) ? 'caution' : 'clear';
      const next = {
        severity,
        zone: cell.zone || (status !== 'clear' ? previous?.zone : null),
        src: cell.src || (status !== 'clear' ? previous?.src : null)
      };
      _smoothedCells[index] = next;
      return { ...cell, status, zone: next.zone, src: next.src, occupancy: severity };
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     NAVIGATION ADVICE
  ═══════════════════════════════════════════════════════════════ */
  function _computeAdvice(grid) {
    const isObs = c => c.status === 'obstacle';

    // Bottom row — visually nearest image region (not a metric distance)
    const near = grid.filter(c => c.r === ROWS - 1);
    // Middle row — intermediate image region
    const mid  = grid.filter(c => c.r === ROWS - 2);

    const nL  = near.filter(c => c.c < 2);
    const nC  = near.filter(c => c.c === 2);
    const nR  = near.filter(c => c.c > 2);
    const mC  = mid.filter(c => c.c >= 1 && c.c <= 3);

    const lClear  = nL.every(c => !isObs(c));
    const cClear  = nC.every(c => !isObs(c));
    const rClear  = nR.every(c => !isObs(c));
    const mcClear = mC.every(c => !isObs(c));

    // Closest detected obstacle in center path
    const cObs  = nC.find(isObs) || mC.find(isObs);
    const cZone = cObs?.zone || 'medium';

    let speech = '', summary = '', direction = 'forward';

    if (lClear && cClear && rClear && mcClear) {
      speech    = 'No tracked obstacle is ahead. Continue carefully.';
      summary   = 'No alert ahead';
      direction = 'forward';

    } else if (cClear && mcClear) {
      summary   = 'No center alert';
      direction = 'forward';
      speech    = 'No tracked obstacle is in the center.';
      if (!lClear) speech += ' Obstacles to your left.';
      if (!rClear) speech += ' Obstacles to your right.';

    } else if (!cClear && lClear && !rClear) {
      summary   = 'Turn left';
      direction = 'left';
      speech    = `Obstacle directly ahead${cZone === 'danger' ? ', in the nearest range' : ''}. The left side appears clearer.`;

    } else if (!cClear && !lClear && rClear) {
      summary   = 'Turn right';
      direction = 'right';
      speech    = `Obstacle directly ahead${cZone === 'danger' ? ', in the nearest range' : ''}. The right side appears clearer.`;

    } else if (!cClear && lClear && rClear) {
      summary   = 'Obstacle ahead';
      direction = 'split';
      speech    = 'Obstacle directly ahead. Both sides currently have fewer alerts.';

    } else if (!cClear && !lClear && !rClear) {
      summary   = 'Blocked';
      direction = 'stop';
      speech    = 'Path blocked on all sides. Please stop and look around carefully.';

    } else {
      summary   = 'Caution';
      direction = 'slow';
      speech    = 'Caution ahead. Proceed slowly.';
    }

    return { speech, summary, direction, lClear, cClear, rClear };
  }

  /* ═══════════════════════════════════════════════════════════════
     CANVAS OVERLAY  (drawn BEFORE bounding boxes)
  ═══════════════════════════════════════════════════════════════ */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ grid, advice, COLS, ROWS }} result
   * @param {number} dw  — display canvas width (may differ from video width)
   * @param {number} dh  — display canvas height
   */
  function drawOverlay(ctx, result, dw, dh, safeDir) {
    if (!ctx || !result) return;
    const { grid, advice } = result;
    // safeDir from riskEngine overrides simple grid advice when available
    const dir = safeDir || advice;

    const cellW = dw / COLS;
    const cellH = dh / ROWS;

    // ── 1. Cell tints ─────────────────────────────────────────────
    grid.forEach(cell => {
      ctx.fillStyle = _cellColor(cell);
      ctx.fillRect(cell.c * cellW, cell.r * cellH, cellW, cellH);
    });

    // ── 2. Subtle grid lines (only near + mid rows) ────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth   = 0.5;
    for (let r = 1; r < ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * cellH); ctx.lineTo(dw, r * cellH);
      ctx.stroke();
    }
    for (let c = 1; c < COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cellW, cellH); ctx.lineTo(c * cellW, dh);
      ctx.stroke();
    }

    // ── 3. Navigation ribbon (bottom strip) ───────────────────────
    _drawRibbon(ctx, dir, dw, dh);

    // ── 4. Direction arrow ────────────────────────────────────────
    _drawArrow(ctx, dir, dw, dh);
  }

  function _cellColor(cell) {
    if (cell.status === 'obstacle') {
      switch (cell.zone) {
        case 'danger': return 'rgba(248,113,113,0.42)';
        case 'close':  return 'rgba(251,146,60,0.36)';
        default:       return 'rgba(250,204,21,0.28)';
      }
    }
    if (cell.status === 'caution') return 'rgba(250,204,21,0.16)';
    // Clear — subtle green only on near+mid rows
    return cell.r >= 1 ? 'rgba(74,222,128,0.14)' : 'rgba(74,222,128,0.06)';
  }

  function _drawRibbon(ctx, advice, w, h) {
    const rH = 30;
    const y  = h - rH;
    const t3 = w / 3;

    const panels = [
      { x: 0,      label: advice.lClear ? '← No alert' : '← Block', clear: advice.lClear },
      { x: t3,     label: advice.cClear ? '▲ No alert' : '⛔ Obstacle',  clear: advice.cClear },
      { x: t3 * 2, label: advice.rClear ? 'No alert →' : 'Block →',  clear: advice.rClear },
    ];

    panels.forEach(p => {
      ctx.fillStyle = p.clear
        ? 'rgba(52,211,153,0.82)'
        : 'rgba(248,113,113,0.82)';
      ctx.fillRect(p.x, y, t3, rH);

      ctx.fillStyle   = 'rgba(0,0,0,0.85)';
      ctx.font        = 'bold 11px Inter, system-ui, sans-serif';
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.label, p.x + t3 / 2, y + rH / 2);
    });

    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function _drawArrow(ctx, advice, w, h) {
    // Position: 40% from bottom, centered horizontally
    const cx = w / 2;
    const cy = h * 0.56;
    const sz = Math.min(w, h) * 0.055;

    const DIR = {
      forward: { color: '#4ade80', angle: 0         },
      left:    { color: '#60a5fa', angle: -Math.PI/5 },
      right:   { color: '#60a5fa', angle:  Math.PI/5 },
      split:   { color: '#facc15', angle: 0          },
      slow:    { color: '#facc15', angle: 0          },
      stop:    { color: '#f87171', angle: null        },
    };
    const d = DIR[advice.direction] || DIR.slow;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowBlur = 18;
    ctx.shadowColor = d.color;

    if (d.angle === null) {
      // ✗ stop symbol
      ctx.strokeStyle = d.color;
      ctx.lineWidth   = 4;
      ctx.globalAlpha = 0.88;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-sz, -sz); ctx.lineTo(sz, sz); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sz, -sz);  ctx.lineTo(-sz, sz); ctx.stroke();
    } else {
      ctx.rotate(d.angle);
      // Arrow chevron
      ctx.globalAlpha = 0.88;
      ctx.fillStyle   = d.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(0,        -sz * 1.9);
      ctx.lineTo(sz,        sz * 0.3);
      ctx.lineTo(sz * 0.38, sz * 0.3);
      ctx.lineTo(sz * 0.38, sz * 1.3);
      ctx.lineTo(-sz * 0.38,sz * 1.3);
      ctx.lineTo(-sz * 0.38,sz * 0.3);
      ctx.lineTo(-sz,       sz * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 1;
  }

  /* ═══════════════════════════════════════════════════════════════
     ANNOUNCEMENT THROTTLE
  ═══════════════════════════════════════════════════════════════ */
  function shouldAnnounce(advice) {
    const now = Date.now();
    const elapsed = now - _prevSigTime;
    if (advice.summary !== _prevSig && elapsed > CHANGE_CD) return true;
    if (advice.summary === _prevSig && elapsed > REPEAT_CD)  return true;
    return false;
  }

  function markSent(advice) {
    _prevSig     = advice.summary;
    _prevSigTime = Date.now();
  }

  /* ─── Helpers ────────────────────────────────────────────────── */
  function _zoneWeight(z) {
    return { danger: 4, close: 3, medium: 2, far: 1 }[z] || 0;
  }

})();
