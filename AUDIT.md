# VisionGuide engineering audit

Audit date: 2026-09-15

## Executive result

The app now has coordinated live-vision and live walking-navigation paths:

`camera frame → COCO-SSD → ByteTracker → relative depth → risk/free-space analysis → immutable scene state → overlay + live card + prioritized speech`

OCR is a separate, page-exclusive consumer of the same physical camera. Camera ownership is enforced so Camera Guide and OCR cannot retain competing streams. Navigation now uses live browser geolocation, submitted Nominatim-compatible search, GraphHopper walking routes, and MapLibre/OpenStreetMap rendering. Camera and navigation guidance share the prioritized speech manager. Camera-free scenes and SOS remain explicitly simulated.

## Repository and runtime map

This is a browser application with a small Node server. The server keeps the GraphHopper key out of browser code, proxies routing/geocoding, rate-limits and caches public Nominatim searches, and serves the pinned MapLibre package. There is no database, account service, WebSocket, or service worker.

| Area | Files | Runtime role |
|---|---|---|
| Shell and UI | `index.html`, `app.js`, `camera.js`, CSS | SPA rendering, accessibility preferences, camera/OCR lifecycle |
| Shared coordination | `visionConfig.js`, `sceneState.js`, `guidanceManager.js` | Thresholds, normalized frame contract, speech priority/deduplication |
| Live vision | `objectDetection.js`, `tracker.js`, `depthEstimation.js`, `freeSpaceAnalyzer.js`, `riskEngine.js` | Detection, identity, relative depth, grid occupancy, risk and direction |
| OCR | `ocrReader.js` | Tesseract worker, capture preprocessing, text history and speech |
| Voice input/output | `voiceCommands.js`, `app.js`, `guidanceManager.js` | SpeechRecognition command routing and serialized SpeechSynthesis |
| Navigation | `locationService.js`, `destinationSearch.js`, `routingService.js`, `routeTracker.js`, `navigationEngine.js`, `mapController.js`, `navigationController.js` | GPS, search, walking routes, progress, rerouting, MapLibre, UI |
| Delivery | `server.cjs`, `START-WINDOWS.bat`, `package.json` | Local hosting, protected provider proxy, MapLibre assets, and checks |

Third-party models/libraries load at runtime from jsDelivr and Hugging Face: TensorFlow.js, COCO-SSD, Transformers.js/Depth Anything V2, and Tesseract.js English data.

## Defects found and resolution

### Critical — fixed

- Rectangular Hungarian assignment padded with `Infinity` and could index outside the matrix when detection counts changed. The tracker now uses a rectangular assignment algorithm with matrix transposition.
- Every SPA render replaced the live video/canvas nodes while inference retained detached nodes. Camera attachment now rebinds detection, depth, overlay, and OCR consumers after each render; in-flight results from replaced video nodes are discarded.
- Relative inverse depth was interpreted in the wrong direction and presented as exact metres. Higher Depth Anything output is now treated as closer, normalized with robust per-frame quantiles, labeled only as relative range, smoothed by track, and rejected when stale.
- Independent object and direction announcements canceled one another. A single risk-prioritized queue now performs interruption, deduplication, cooldown, age expiry, and deterministic serialization.

### High — fixed

- Free-space depth anomalies could recommend a side while the speech layer announced no obstacle. Depth-only patterns now produce cautious guidance, and full-view blockage produces an immediate stop decision.
- Guidance throttling existed, but decision hysteresis did not. Direction changes now require a material improvement and consecutive confirmation, except urgent stop/high-center hazards.
- New hazards were delayed by smoothing. Hazard severity now rises immediately and only clearance decays gradually.
- OCR camera requests were unguarded and could leak late streams or publish results after leaving the page. Requests have IDs, stale streams are stopped, recognition results carry a session generation, and camera-ended/hidden/page-leave paths clean up.
- Repeated concurrent model initialization was possible. Object detection, depth, and OCR now share in-flight initialization promises.

### Medium — fixed

- Depth encoded full camera frames to JPEG/data URLs before inference. It now reuses a bounded canvas and passes it directly to the model.
- OCR allocated and processed a full-resolution canvas on every scan. It now reuses a pixel-bounded capture canvas and suppresses adjacent duplicate history entries.
- Risk histories and per-track depth smoothing could outlive disappeared tracks. Both are pruned with the active track set and reset at session boundaries.
- Live Camera Guide showed simulated cue controls alongside real inference. Live mode now consumes the shared scene state; predefined controls appear only in demo mode.
- Status and product copy overstated clearance and physical distance. Live wording now uses “estimated,” “appears,” “no tracked obstacle,” and explicit experimental limitations.

## Scheduling and memory behavior

- COCO detection is serialized at a configurable interval and starts the next frame only after the prior frame completes. Errors use a longer retry delay.
- Relative depth runs on its own slower serialized cadence with a bounded input edge. Stale maps are excluded.
- OCR prevents concurrent scans and schedules the next auto-scan only after the current recognition finishes.
- Video streams, timers, overlays, scene state, histories, and per-track maps are cleared on stop/hide/page leave. Loaded model singletons remain cached intentionally so reopening a feature does not repeatedly download and allocate models; no additional model instance is created per session.

## Verification

`npm test` covers:

- opt-in camera and microphone behavior, denial recovery, late-permission cleanup, track-ended and hidden-page cleanup;
- all existing navigation, demo, OCR, settings, SOS, and accessibility flows;
- voice command routing for camera, live description, OCR, navigation, SOS, repeat, and page access;
- rectangular 2→1→2 tracker association and stable identity;
- immediate obstacle elevation, direction hysteresis, blocked-view stop, and non-metric depth fallback;
- immutable normalized scene output and urgent speech interruption/drop behavior.

The local server was smoke-tested over HTTP: the page and voice controller returned 200 and the global voice control was present. Native/browser visual automation was unavailable in this environment, and installed Chromium headless rendering failed in its GPU process, so a physical-camera visual pass is still required on the target device.

## Remaining limitations and recommended phases

1. **Browser/device validation:** run Chrome/Edge tests with representative front/rear cameras, low light, rotation, tab suspension, denied permissions, screen readers, and sustained 15–30 minute sessions.
2. **Performance isolation:** move supported preprocessing/risk work into workers and add adaptive cadence based on measured inference time and page/device pressure. Tesseract already performs recognition in its worker.
3. **Model resilience:** vendor/version model assets for offline deployment, add download progress/retry, and provide integrity/CSP controls. The current cold start requires network access.
4. **Distance claims:** keep relative labels unless calibrated metric depth or a device depth sensor is introduced. Monocular relative depth cannot provide dependable metres by itself.
5. **Safety productization:** validate on a labeled video corpus, measure false-negative/false-positive rates, test direction stability, and complete accessibility and human-factors reviews before any mobility-aid claim.
6. **Real services:** actual maps/location, emergency contact delivery, accounts, and remote inference would require authenticated backend/API contracts; none are implied or faked by this static prototype.

The present implementation is an experimental assistive interface, not a certified navigation, collision-avoidance, or emergency system.
