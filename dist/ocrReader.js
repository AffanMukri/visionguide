// ═══════════════════════════════════════════════════════════════════
//  VisionGuide — OCR Text Reader (Tesseract.js)
//
//  Pipeline:
//    Camera frame capture  (hidden canvas)
//     ↓
//    Tesseract.js Worker   (runs in-browser, no server)
//     ↓
//    Cleaned text          (de-noise, strip junk chars)
//     ↓
//    Text-to-Speech        (Web Speech API → speak())
//     ↓
//    Results panel         (live OCR output with confidence)
//
//  Features:
//   • One-shot "Scan Now" capture — no runaway processing
//   • Continuous "Auto-scan" mode — every 3 s
//   • Language: English (tesseract trained data loaded from CDN)
//   • Text highlight overlay drawn on captured frame
//   • History of last 5 scans with timestamps
//   • Confidence indicator (%) per scan
//
//  Tesseract.js CDN: https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js
//
//  Exposes: window.ocrAPI
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  /* ─── State ─────────────────────────────────────────────────── */
  let _worker      = null;
  let _workerReady = false;
  let _loading     = false;
  let _loadPromise = null;
  let _autoTimer   = null;
  let _videoEl     = null;
  let _scanGeneration = 0;
  const _captureCanvas = document.createElement('canvas');

  const CFG            = window.VisionGuideConfig?.ocr || {};
  const AUTO_INTERVAL  = CFG.autoIntervalMs || 3000;
  const HIST_MAX       = CFG.historyMax || 5;
  const MIN_CONF       = CFG.minConfidence || 40;
  const MIN_TEXT_LEN   = CFG.minTextLength || 2;
  const MAX_PIXELS     = CFG.maxCapturePixels || 1200000;

  let _history     = [];         // [{text, conf, time, thumb}]
  let _scanning    = false;      // guard against concurrent scans
  let _autoActive  = false;
  let _lastText    = '';         // for duplicate suppression
  let _lastSpeakTime = 0;
  const REPEAT_CD  = CFG.repeatCooldownMs || 7000;

  /* ─── Public API ─────────────────────────────────────────────── */
  window.ocrAPI = {
    loadWorker,
    scanOnce,
    startAuto,
    stopAuto,
    setVideo: v => { _videoEl = v; },
    cancelPending,
    getHistory: () => _history,
    isReady:  () => _workerReady,
    isLoading:() => _loading,
    isAuto:   () => _autoActive,
    reset,
  };

  /* ═══════════════════════════════════════════════════════════════
     WORKER INITIALISATION
     Tesseract.js v5 uses a single createWorker() API.
  ═══════════════════════════════════════════════════════════════ */
  async function loadWorker(onProgress) {
    if (_workerReady) return _worker;
    if (_loadPromise) return _loadPromise;
    _loading = true;
    _emitStatus('loading', '⏳ Loading OCR engine…');

    _loadPromise = (async () => { try {
      if (!window.Tesseract?.createWorker) throw new Error('Tesseract.js is unavailable');
      // Tesseract.js v5 — createWorker with language + logger
      _worker = await Tesseract.createWorker('eng', 1, {
        logger: m => {
          if (m.status === 'loading tesseract core') {
            _emitStatus('loading', '⏳ Loading Tesseract core…');
          }
          if (m.status === 'loading language traineddata') {
            _emitStatus('loading', '⏳ Loading English language data…');
          }
          if (m.status === 'initialized api') {
            // done handled below
          }
          if (typeof onProgress === 'function' && m.progress !== undefined) {
            onProgress(Math.round(m.progress * 100));
          }
        },
      });

      // Optimise for signboards / large text
      await _worker.setParameters({
        tessedit_char_whitelist: '',                // all chars
        tessedit_pageseg_mode: Tesseract.PSM.AUTO, // auto layout
      });

      _workerReady = true;
      _loading     = false;
      _emitStatus('ready', '✅ OCR ready — point camera at text');
      if (window.VisionGuideConfig?.debug) console.info('[VisionGuide OCR] Tesseract.js worker ready');
      return _worker;
    } catch (err) {
      _loading = false;
      _workerReady = false;
      _worker = null;
      _emitStatus('error', '⚠️ OCR failed to load');
      if (window.VisionGuideConfig?.debug) console.error('[VisionGuide OCR] Worker init failed:', err);
      throw err;
    } finally {
      _loadPromise = null;
    } })();
    return _loadPromise;
  }

  /* ═══════════════════════════════════════════════════════════════
     SINGLE SCAN
  ═══════════════════════════════════════════════════════════════ */
  async function scanOnce() {
    if (!_workerReady || _scanning) return null;
    if (!_videoEl || _videoEl.readyState < 2 || !_videoEl.videoWidth) {
      _emitStatus('ready', '📷 Camera not ready yet');
      return null;
    }

    const generation = _scanGeneration;
    const sourceVideo = _videoEl;
    _scanning = true;
    _emitStatus('scanning', '🔍 Scanning for text…');

    try {
      // ── Capture frame ───────────────────────────────────────────
      const sourceW = sourceVideo.videoWidth;
      const sourceH = sourceVideo.videoHeight;
      const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (sourceW * sourceH)));
      const vw = Math.max(1, Math.round(sourceW * scale));
      const vh = Math.max(1, Math.round(sourceH * scale));
      const canvas = _captureCanvas;
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(sourceVideo, 0, 0, vw, vh);

      // ── Pre-process: enhance contrast for text recognition ──────
      _enhanceContrast(ctx, vw, vh);

      // ── Tesseract OCR ───────────────────────────────────────────
      const { data } = await _worker.recognize(canvas);
      // Tesseract work cannot be aborted safely. Discard a result if the page,
      // stream, or OCR session changed while recognition was running.
      if (generation !== _scanGeneration || sourceVideo !== _videoEl) return null;
      const rawText  = data.text || '';
      const conf     = Math.round(data.confidence || 0);

      // ── Clean text ──────────────────────────────────────────────
      const clean = _cleanText(rawText);

      // Generate a small thumbnail (dataURL) for history
      const thumb = _thumbnail(canvas);

      const accepted = clean.length >= MIN_TEXT_LEN && conf >= MIN_CONF;
      const result = { text: clean, conf, raw: rawText, time: Date.now(), thumb, accepted };

      if (accepted) {
        // Auto-scan should not fill history with identical adjacent results.
        const previous = _history[0];
        if (previous?.text === clean && result.time - previous.time < (CFG.historyDuplicateMs || 30000)) {
          _history[0] = result;
        } else {
          _history.unshift(result);
          if (_history.length > HIST_MAX) _history.pop();
        }

        // Announce if it's new or enough time has passed
        _announceText(clean);

        _emitStatus('done', `📖 "${_truncate(clean, 40)}" (${conf}% conf)`);
      } else if (clean.length > 0) {
        _emitStatus('done', `🔎 Low confidence (${conf}%) — try better lighting`);
      } else {
        _emitStatus('done', '🔎 No text found — point at a sign or label');
      }

      // Draw OCR result overlay on preview
      _drawOcrOverlay(data.words, vw, vh);

      return result;

    } catch (err) {
      if (generation === _scanGeneration) _emitStatus('ready', '⚠️ Scan failed — try again');
      if (window.VisionGuideConfig?.debug) console.warn('[VisionGuide OCR] Scan error:', err);
      return null;
    } finally {
      if (generation === _scanGeneration) _scanning = false;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     AUTO SCAN MODE
  ═══════════════════════════════════════════════════════════════ */
  function startAuto() {
    if (_autoActive) return true;
    if (!_workerReady || !_videoEl) return false;
    _autoActive = true;
    _scheduleAuto();
    return true;
  }

  function stopAuto() {
    _autoActive = false;
    clearTimeout(_autoTimer);
    _autoTimer  = null;
    // Remove overlay if it's showing
    const ov = document.getElementById('ocr-word-overlay');
    if (ov) ov.style.display = 'none';
  }

  function cancelPending() {
    _scanGeneration++;
    _scanning = false;
    _videoEl = null;
    stopAuto();
  }

  function _scheduleAuto() {
    if (!_autoActive) return;
    _autoTimer = setTimeout(async () => {
      if (!_autoActive) return;
      await scanOnce();
      _scheduleAuto();
    }, AUTO_INTERVAL);
  }

  function reset() {
    cancelPending();
    _history   = [];
    _lastText  = '';
  }

  /* ═══════════════════════════════════════════════════════════════
     TEXT CLEANING
     Remove OCR artifacts, control chars, standalone noise chars
  ═══════════════════════════════════════════════════════════════ */
  function _cleanText(raw) {
    return raw
      .replace(/[^\x20-\x7E\n]/g, '')   // printable ASCII + newline
      .replace(/\|/g, 'I')              // common OCR pipe→I mistake
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length >= 2)       // drop 1-char lines
      .filter(l => /[a-zA-Z0-9]/.test(l)) // must have alphanumeric
      .join(' · ')                      // join lines with separator
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /* ─── Contrast boost (simple pixel manipulation) ─────────────── */
  function _enhanceContrast(ctx, w, h) {
    try {
      const id = ctx.getImageData(0, 0, w, h);
      const d  = id.data;
      const f  = 1.4; // contrast factor
      const intercept = 128 * (1 - f);
      for (let i = 0; i < d.length; i += 4) {
        d[i]   = Math.max(0, Math.min(255, d[i]   * f + intercept));
        d[i+1] = Math.max(0, Math.min(255, d[i+1] * f + intercept));
        d[i+2] = Math.max(0, Math.min(255, d[i+2] * f + intercept));
      }
      ctx.putImageData(id, 0, 0);
    } catch (e) {
      // Cross-origin or security restriction — skip enhancement
    }
  }

  /* ─── Thumbnail ───────────────────────────────────────────────── */
  function _thumbnail(srcCanvas) {
    try {
      const c = document.createElement('canvas');
      c.width  = 80; c.height = 45;
      c.getContext('2d').drawImage(srcCanvas, 0, 0, 80, 45);
      return c.toDataURL('image/jpeg', 0.6);
    } catch { return null; }
  }

  /* ─── Word-level overlay on video preview ─────────────────────── */
  function _drawOcrOverlay(words, vw, vh) {
    const ov = document.getElementById('ocr-word-overlay');
    if (!ov) return;
    const dw = ov.offsetWidth  || vw;
    const dh = ov.offsetHeight || vh;
    ov.width  = dw;
    ov.height = dh;
    const ctx = ov.getContext('2d');
    ctx.clearRect(0, 0, dw, dh);
    if (!words || !words.length) return;

    const sx = dw / vw, sy = dh / vh;

    words.forEach(w => {
      if (!w.bbox || w.confidence < MIN_CONF || w.text.trim().length < 2) return;
      const { x0, y0, x1, y1 } = w.bbox;
      const rx = x0 * sx, ry = y0 * sy, rw = (x1-x0) * sx, rh = (y1-y0) * sy;

      // Highlight box
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth   = 2;
      ctx.shadowColor = '#a78bfa';
      ctx.shadowBlur  = 8;
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, 3);
      ctx.stroke();
      ctx.shadowBlur  = 0;

      // Word label
      ctx.fillStyle   = 'rgba(88,28,135,0.82)';
      ctx.fillRect(rx, ry - 18, rw, 18);
      ctx.fillStyle   = '#e9d5ff';
      ctx.font        = 'bold 11px Inter, system-ui, sans-serif';
      ctx.fillText(_truncate(w.text, 12), rx + 3, ry - 4);
    });
  }

  /* ─── Speech ───────────────────────────────────────────────────  */
  function _announceText(text) {
    const now     = Date.now();
    const isNew   = text !== _lastText;
    const elapsed = now - _lastSpeakTime;

    if (isNew || elapsed > REPEAT_CD) {
      _lastText      = text;
      _lastSpeakTime = now;
      const speech   = isNew ? `Text detected: ${text}` : text;
      if (window.guidanceAPI) {
        window.guidanceAPI.announce(speech, { priority: 45, key: `ocr:${text.toLowerCase()}`, cooldownMs: REPEAT_CD });
      } else if (typeof speak === 'function') speak(speech);
    }
  }

  /* ─── Status badge ─────────────────────────────────────────────── */
  function _emitStatus(state, text) {
    const el = document.getElementById('ocr-status-badge');
    if (!el) return;
    el.textContent = text;
    el.className   = `ocr-status-badge ocr-badge-${state}`;
  }

  /* ─── Helpers ──────────────────────────────────────────────────── */
  function _truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

})();
