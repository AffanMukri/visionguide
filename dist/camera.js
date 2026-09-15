// Camera frames stay in the browser. Live guidance is derived from sceneState;
// the six predefined situations are available only in explicit demo mode.
let cameraStream = null;
let cameraState = 'off';
let cameraError = '';
let cameraRequest = 0;
let cameraFacing = 'environment';
let cameraDemo = false;
let cameraStep = 0;
let cameraPlaying = false;
let cameraTimer = null;
let focusView = false;
let voiceState = 'Ready to speak';
let speechVersion = 0;
const cameraScenes = [
  { object: 'Pole ahead', distance: '1.5 m', action: 'Move slightly left', detail: 'Give the obstacle more space.', icon: 'left', tone: 'caution', label: 'Pole' },
  { object: 'Person on your left', distance: '2.1 m', action: 'Keep to the right', detail: 'Pass with a little more room.', icon: 'right', tone: 'clear', label: 'Person' },
  { object: 'Stairs ahead', distance: '2 m', action: 'Slow down', detail: 'Approach the steps carefully.', icon: 'stairs', tone: 'caution', label: 'Stairs' },
  { object: 'Vehicle crossing', distance: '6 m', action: 'Stop and wait', detail: 'Wait before moving ahead.', icon: 'sos', tone: 'stop', label: 'Vehicle' },
  { object: 'Obstacle directly ahead', distance: '0.8 m', action: 'Stop', detail: 'Pause before taking another step.', icon: 'sos', tone: 'stop', label: 'Obstacle' },
  { object: 'Path clear', distance: '', action: 'Continue straight', detail: 'Follow the path ahead.', icon: 'straight', tone: 'clear', label: 'Clear path' }
];

function wave() {
  return '<span class="sound-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>';
}

function cameraActive() { return cameraState === 'live' || cameraDemo; }

function cameraSpeech() {
  const s = cameraScenes[cameraStep];
  return `Demo instruction. ${s.object}${s.distance ? ', ' + s.distance : ''}. ${s.action}.${settings.detail === 'Detailed' ? ' ' + s.detail : ''}`;
}

function refreshVoiceStatus() {
  document.querySelectorAll('[data-voice-status]').forEach(el => { el.textContent = settings.voice ? voiceState : 'Voice is off'; });
  document.querySelectorAll('.sound-wave').forEach(el => { el.classList.toggle('is-speaking', voiceState === 'Speaking' && settings.voice); });
}

function attachCamera() {
  const video = document.getElementById('camera-video');
  if (video && cameraStream) {
    video.srcObject = cameraStream;
    const playing = video.play();
    if (playing?.catch) playing.catch(() => {});
    const canvas = document.getElementById('od-overlay-canvas');
    // render() replaces DOM nodes. Rebind each replacement to the live session.
    window.objectDetectionAPI?.startDetection?.(video, canvas);
    window.depthAPI?.startDepthLoop?.(video);
  }
  if (cameraState === 'live') refreshLiveGuide(window.sceneStateAPI?.getSnapshot?.());
  refreshVoiceStatus();
}

function pauseCameraDemo() {
  cameraPlaying = false;
  clearTimeout(cameraTimer);
  cameraTimer = null;
}

function stopCamera({ announce = false } = {}) {
  cameraRequest++;
  if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
  cameraStream = null;
  cameraState = 'off';
  cameraError = '';
  pauseCameraDemo();
  // Stop object detection + depth estimation when camera turns off
  if (window.objectDetectionAPI) window.objectDetectionAPI.stopDetection();
  if (window.depthAPI) window.depthAPI.stopDepthLoop();
  if (announce) speak('Camera is off.');
}

async function requestCamera() {
  if (cameraState === 'requesting') return;
  if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
    cameraState = 'error';
    cameraError = 'Camera access is unavailable in this browser. You can still try spoken demo guidance.';
    render();
    return;
  }
  stopCamera();
  if (typeof stopOcrCamera === 'function') stopOcrCamera();
  cameraDemo = false;
  cameraState = 'requesting';
  const requestId = ++cameraRequest;
  render();
  try {
    const cameraConfig = window.VisionGuideConfig?.camera || {};
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: cameraFacing }, width: { ideal: cameraConfig.width || 1280 }, height: { ideal: cameraConfig.height || 720 } }, audio: false });
    // A late permission response must never reopen a camera after leaving.
    if (requestId !== cameraRequest || page !== 'camera' || document.hidden) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    cameraStream = stream;
    cameraState = 'live';
    stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
      if (cameraStream !== stream) return;
      cameraStream = null;
      cameraState = 'error';
      cameraError = 'The camera stopped. Reconnect it or continue without a camera.';
      pauseCameraDemo();
      if (window.objectDetectionAPI) window.objectDetectionAPI.stopDetection();
      if (window.depthAPI) window.depthAPI.stopDepthLoop();
      if (page === 'camera') render();
    }));
    render();
    speak('Camera is on. Live object awareness is starting. Depth labels are relative estimates, not measured distances.', { priority: 60 });
  } catch (error) {
    if (requestId !== cameraRequest || page !== 'camera') return;
    cameraState = 'error';
    cameraError = ({ NotAllowedError: 'Camera access was not allowed. Enable it in your browser’s site permissions, then try again.', NotFoundError: 'No camera was found on this device.', NotReadableError: 'Your camera may be in use by another app. Close it there, then try again.', SecurityError: 'This browser has blocked camera access.' })[error.name] || 'The camera could not start. Try again or continue without it.';
    render();
    speak(cameraError + ' You can use the demo without a camera.');
  }
}

function scheduleCameraStep() {
  clearTimeout(cameraTimer);
  if (!cameraPlaying || !cameraActive() || page !== 'camera') return;
  cameraTimer = setTimeout(() => {
    if (cameraStep === cameraScenes.length - 1) {
      pauseCameraDemo();
      render();
      toast('Demo complete. You can replay any cue.');
      return;
    }
    setCameraStep(cameraStep + 1, true);
  }, 9000);
}

function setCameraStep(index, automatic = false) {
  cameraStep = Math.max(0, Math.min(cameraScenes.length - 1, index));
  const s = cameraScenes[cameraStep];
  if (!automatic || s.tone === 'stop' || s.tone === 'caution') pauseCameraDemo();
  render();
  speak(cameraSpeech());
  scheduleCameraStep();
}function cameraPanel() {
  if (cameraState === 'live') {
    const odReady    = window.objectDetectionAPI?.isModelLoaded();
    const depthReady = window.depthAPI?.isLoaded();
    return `<section class="camera-panel" aria-label="Camera preview">
      <div class="panel-caption">
        <span>${icon('camera')} Camera preview</span>
        <span class="live-chip">Live · Risk · Safe-Dir · Depth</span>
      </div>
      <div class="video-wrap" style="position:relative">
        <video id="camera-video" autoplay playsinline muted aria-label="Live camera with object detection and distance estimation."></video>
        <canvas id="od-overlay-canvas" aria-hidden="true" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none"></canvas>
        <span class="video-caption">Your camera · Detection + Depth active</span>
        <span id="od-status-badge" class="od-status-badge ${odReady ? 'od-badge-ready' : 'od-badge-loading'}">
          ${odReady ? '✅ Object detection ready' : '⏳ Loading object detection…'}
        </span>
        <span id="depth-status-badge" class="depth-status-badge ${depthReady ? 'depth-badge-ready' : 'depth-badge-loading'}">
          ${depthReady ? 'Depth model ready' : 'Using size-based range'}
        </span>
      </div>
      <div class="od-detection-panel">
        <div class="od-panel-header">
          <span class="od-panel-title">${icon('environment')} Objects · Distance · Navigation</span>
          <span class="od-panel-hint">Tracked objects · Relative range · Path analysis</span>
        </div>
        <div id="od-detected-list" class="od-detected-list">
          <span class="od-empty">Starting detection…</span>
        </div>
      </div>
      <div class="camera-controls">${btn(icon('camera') + ' Switch camera', 'switch-camera')}${btn('Turn camera off', 'camera-off')}</div>
      <p class="camera-disclaimer">Experimental visual assistance only. Range and path-clearance labels are relative estimates and may be wrong. Do not rely on this prototype for mobility or safety decisions.</p>
    </section>`;
  }
  return `<section class="camera-panel camera-off-panel"><div class="panel-caption"><span>${icon('camera')} Camera preview</span><span class="live-chip">Off</span></div><div class="camera-empty"><span class="camera-symbol">${icon('camera')}</span><h2>${cameraState === 'requesting' ? 'Allow camera access' : cameraState === 'error' ? 'Let\u2019s try another way.' : cameraDemo ? 'Demo without a camera' : 'Your camera. Your choice.'}</h2><p>${cameraState === 'requesting' ? 'Your browser will ask for permission. You can allow access or continue without it.' : cameraState === 'error' ? esc(cameraError) : 'AI detects objects and estimates distance. Objects are announced with their distance aloud.'}</p><div class="permission-actions">${btn(cameraState === 'requesting' ? 'Waiting for permission\u2026' : cameraState === 'error' ? 'Try camera again' : 'Allow camera access', 'allow-camera', 'primary wide', cameraState === 'requesting' ? 'disabled' : '')}${btn(cameraDemo ? 'Replay current cue' : 'Try without camera', cameraDemo ? 'camera-repeat' : 'camera-demo', 'text-button wide')}</div></div></section>`;
}


function guideCard() {
  const s = cameraScenes[cameraStep];
  return `<section class="guide-card ${s.tone}" aria-labelledby="current-direction"><div class="guide-meta"><span class="guide-label">${icon('shield')} Demo instruction</span><span class="cue-count">${String(cameraStep + 1).padStart(2, '0')} / 06</span></div><div class="guide-direction" aria-hidden="true">${icon(s.icon)}</div><h2 id="current-direction">${s.action}</h2><div class="object-cue"><span>${icon(s.label === 'Person' ? 'person' : s.label === 'Vehicle' ? 'car' : s.label === 'Stairs' ? 'stairs' : 'environment')}</span><div><strong>${s.object}</strong><p>${s.distance ? 'Sample distance · ' + s.distance : 'Sample clear-path scenario'}</p></div></div>${settings.detail === 'Detailed' ? `<p class="guide-detail">${s.detail}</p>` : ''}<div class="voice-strip">${wave()}<div><strong data-voice-status>${settings.voice ? voiceState : 'Voice is off'}</strong><p>Spoken directions, one at a time</p></div></div>${btn(icon('voice') + (settings.voice ? ' Repeat instruction' : ' Turn on voice'), settings.voice ? 'camera-repeat' : 'camera-voice', 'repeat-button wide')}</section>`;
}

function liveGuideCard() {
  return `<section class="guide-card caution" id="live-guide-card" aria-labelledby="current-direction" aria-live="polite">
    <div class="guide-meta"><span class="guide-label">${icon('shield')} Live scene guidance</span><span class="cue-count" id="live-scene-status">Starting</span></div>
    <div class="guide-direction" id="live-guide-icon" aria-hidden="true">${icon('straight')}</div>
    <h2 id="current-direction"><span id="live-guide-action">Analysing the scene…</span></h2>
    <div class="object-cue"><span>${icon('environment')}</span><div><strong id="live-guide-object">Waiting for a camera frame</strong><p id="live-guide-range">Relative range only</p></div></div>
    <div class="voice-strip">${wave()}<div><strong data-voice-status>${settings.voice ? voiceState : 'Voice is off'}</strong><p>Important cues are queued by risk</p></div></div>
    ${btn(icon('voice') + (settings.voice ? ' Describe current scene' : ' Turn on voice'), settings.voice ? 'camera-repeat' : 'camera-voice', 'repeat-button wide')}
  </section>`;
}

function refreshLiveGuide(scene) {
  if (!scene || cameraState !== 'live') return;
  const action = document.getElementById('live-guide-action');
  if (!action) return;
  const dir = scene.recommendedDirection;
  const dirText = { left: 'Move slightly left', right: 'Move slightly right', center: 'Continue carefully' }[dir];
  const unavailable = scene.status === 'error' || scene.status === 'degraded';
  action.textContent = unavailable ? 'Visual analysis unavailable' : scene.guidanceMessage || dirText || 'Continue carefully';
  const object = [...(scene.objects || [])].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0))[0];
  document.getElementById('live-guide-object').textContent = unavailable ? 'Current frame analysis is paused' : object ? `${object.label} ${object.position || 'ahead'}` : 'No supported obstacle detected';
  document.getElementById('live-guide-range').textContent = unavailable ? 'Do not rely on the previous result' : object?.distanceLabel || 'No measured distance · continue carefully';
  document.getElementById('live-scene-status').textContent = scene.status === 'active' ? 'Live' : scene.status;
  const card = document.getElementById('live-guide-card');
  card.classList.remove('clear', 'caution', 'stop');
  card.classList.add(object?.riskLevel === 'high' ? 'stop' : object?.riskLevel === 'medium' ? 'caution' : 'clear');
  const iconBox = document.getElementById('live-guide-icon');
  if (iconBox) iconBox.innerHTML = icon(dir === 'left' ? 'left' : dir === 'right' ? 'right' : dir === 'stop' || object?.riskLevel === 'high' ? 'sos' : 'straight');
}

window.sceneStateAPI?.subscribe?.(refreshLiveGuide);

function cameraPage() {
  if (cameraState === 'live') {
    return `<div class="camera-heading"><div><div class="eyebrow">Camera + spoken guidance</div><h1>Your next step,<br class="mobile-break"> loud and clear.</h1></div><div class="camera-heading-actions">${btn(icon(focusView ? 'environment' : 'focus') + (focusView ? ' Full view' : ' Focus view'), 'focus-view', 'quiet-button', `aria-pressed="${focusView}"`)}${btn('End session', 'end-camera', 'quiet-button')}</div></div>
      <p class="prototype-boundary">${icon('shield')} Live experimental analysis. Relative ranges are not physical measurements. Stay stationary while testing.</p>
      <div class="camera-workspace ${focusView ? 'focus-view' : ''}"><div class="guidance-column">${liveGuideCard()}</div>${!focusView ? `<div class="camera-side">${cameraPanel()}<section class="voice-settings-card"><div class="row"><div><h3>Listen your way</h3><p>Adjust the pace of spoken cues.</p></div>${btn(icon(settings.voice ? 'voice' : 'muted') + (settings.voice ? ' Voice on' : ' Voice off'), 'camera-voice', '', `aria-pressed="${settings.voice}"`)}</div>${select('speed', 'Voice speed', [['0.8','Slower'],['1','Normal'],['1.2','Faster']])}</section></div>` : ''}</div>`;
  }
  return `<div class="camera-heading"><div><div class="eyebrow">Camera + spoken guidance</div><h1>Your next step,<br class="mobile-break"> loud and clear.</h1></div><div class="camera-heading-actions">${cameraActive() ? btn(icon(focusView ? 'environment' : 'focus') + (focusView ? ' Full view' : ' Focus view'), 'focus-view', 'quiet-button', `aria-pressed="${focusView}"`) : ''}${btn('End session', 'end-camera', 'quiet-button')}</div></div><p class="prototype-boundary">${icon('shield')} Live camera preview. Simulated directions. Use this demo while stationary.</p>${!cameraActive() ? `<div class="camera-setup-grid">${cameraPanel()}<div class="setup-explainer"><div class="eyebrow">From awareness to action</div><h2>Hear what matters.<br>Know the next step.</h2><div class="example-pair"><div><span>Sample object</span><strong>Pole ahead · 1.5 m</strong></div>${icon('arrow')}<div><span>Spoken direction</span><strong>“Move slightly left.”</strong></div></div><p>Object awareness is demonstrated using six sample situations. Camera images do not control the guidance.</p>${btn(icon('voice') + ' Hear an example', 'hear-example', 'text-button')}<div class="privacy-points"><span>${icon('check')} No microphone needed</span><span>${icon('check')} Camera stops when you leave</span><span>${icon('check')} A camera-free option is always available</span></div></div></div>` : `<div class="camera-workspace ${focusView ? 'focus-view' : ''}"><div class="guidance-column">${guideCard()}<div class="session-controls">${btn(icon('back') + ' Previous', 'camera-previous', '', cameraStep === 0 ? 'disabled' : '')}${btn(icon(cameraPlaying ? 'pause' : 'play') + (cameraPlaying ? ' Pause' : ' Play demo'), 'camera-play')}${btn('Next ' + icon('arrow'), 'camera-next', '', cameraStep === cameraScenes.length - 1 ? 'disabled' : '')}</div><p class="playback-note">${cameraPlaying ? 'Next cue in a few seconds. Warnings pause the demo.' : 'Paused. Continue when you’re ready.'}</p></div>${!focusView ? `<div class="camera-side">${cameraPanel()}<section class="voice-settings-card"><div class="row"><div><h3>Listen your way</h3><p>Adjust the pace of spoken cues.</p></div>${btn(icon(settings.voice ? 'voice' : 'muted') + (settings.voice ? ' Voice on' : ' Voice off'), 'camera-voice', '', `aria-pressed="${settings.voice}"`)}</div>${select('speed', 'Voice speed', [['0.8','Slower'],['1','Normal'],['1.2','Faster']])}</section></div>` : ''}</div><section class="scenario-library ${focusView ? 'sr-only' : ''}" ${focusView ? 'aria-hidden="true" inert' : ''}><div class="row"><h2>Explore a situation</h2><small>Six sample cues</small></div><div class="scenario-buttons">${cameraScenes.map((s,i) => btn(icon(s.icon) + s.label, 'camera-scene', i === cameraStep ? 'selected' : '', `data-id="${i}" aria-pressed="${i === cameraStep}"`)).join('')}</div></section>`}`;
}

function handleCameraAction(action, id) {
  switch (action) {
    case 'camera': go('camera'); break;
    case 'allow-camera': requestCamera(); break;
    case 'camera-demo': stopCamera(); cameraDemo = true; render(); speak(cameraSpeech()); break;
    case 'camera-off': stopCamera({ announce: true }); cameraDemo = false; render(); break;
    case 'switch-camera': cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment'; requestCamera(); break;
    case 'camera-repeat':
      if (cameraState === 'live') speak(window.objectDetectionAPI?.describeLatest?.() || 'The live scene is not ready yet.', { priority: 65 });
      else speak(cameraSpeech());
      break;
    case 'hear-example': speak('Demo instruction. Pole ahead, 1.5 metres. Move slightly left.'); break;
    case 'camera-previous': setCameraStep(cameraStep - 1); break;
    case 'camera-next': setCameraStep(cameraStep + 1); break;
    case 'camera-scene': setCameraStep(id); break;
    case 'camera-play': cameraPlaying = !cameraPlaying; if (cameraPlaying) { if (cameraStep === cameraScenes.length - 1) cameraStep = 0; speak(cameraSpeech()); scheduleCameraStep(); } else { pauseCameraDemo(); cancelVoice(); } render(); break;
    case 'camera-voice': settings.voice = !settings.voice; persist(); if (!settings.voice) cancelVoice(); render(); if (settings.voice) speak(cameraSpeech()); break;
    case 'focus-view': focusView = !focusView; render(); document.querySelector('[data-action="focus-view"]')?.focus(); break;
    case 'end-camera': go('home'); toast('Session ended. Camera is off.'); break;
    case 'listen-preset': settings.voice = true; settings.size = 'Large'; settings.reduce = true; settings.detail = 'Minimal'; settings.speed = '0.8'; focusView = true; persist(); render(); speak('Listen first is ready. Larger text, slower speech and a simple focus view.'); break;
    case 'contrast-preset': settings.contrast = !settings.contrast; settings.size = 'Large'; persist(); render(); toast(settings.contrast ? 'High contrast and large text enabled' : 'High contrast turned off'); break;
    case 'stop-voice': cancelVoice(); toast('Speech stopped'); break;
    default: return false;
  }
  return true;
}

function cancelVoice() {
  window.guidanceAPI?.clear();
  if (typeof _cancelSpeechPlayback === 'function') _cancelSpeechPlayback();
  else {
    speechVersion++;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
  voiceState = 'Ready to speak';
  refreshVoiceStatus();
}

window.addEventListener('pagehide', () => { stopCamera(); if (typeof stopOcrCamera === 'function') stopOcrCamera(); cancelVoice(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  const wasCameraOpen = cameraState === 'live' || cameraState === 'requesting';
  const wasOcrOpen = typeof ocrCameraState !== 'undefined' && (ocrCameraState === 'live' || ocrCameraState === 'requesting');
  stopCamera();
  if (typeof stopOcrCamera === 'function') stopOcrCamera();
  cancelVoice();
  if (page === 'camera' && wasCameraOpen) {
    cameraState = 'error';
    cameraError = 'Camera paused while you were away. Start it again when you’re ready.';
    render();
  } else if (page === 'read' && wasOcrOpen) {
    ocrCameraState = 'error';
    ocrCameraError = 'Camera paused while you were away. Start it again when you’re ready.';
    render();
  }
});
