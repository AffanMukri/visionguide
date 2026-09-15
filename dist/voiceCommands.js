// VisionGuide voice input controller — Web Speech API (SpeechRecognition).
// Speech output remains centralised in app.js so spoken UI and voice-command
// responses share accessibility preferences, rate, volume, and screen-reader mode.
(function () {
  'use strict';

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const toggle = document.getElementById('voice-toggle');
  const status = document.getElementById('voice-status');
  const transcript = document.getElementById('voice-transcript');
  const label = document.getElementById('voice-button-label');
  const root = document.getElementById('voice-control');
  const app = window.visionGuideAPI;

  let recognition = null;
  let enabled = false;
  let running = false;
  let pausedForSpeech = false;
  let restartTimer = null;

  function update(state, message, heard = '') {
    if (root) root.dataset.state = state;
    if (status) status.textContent = message;
    if (transcript) transcript.textContent = heard;
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(enabled));
      toggle.setAttribute('aria-label', enabled ? 'Turn off voice commands' : 'Turn on voice commands');
    }
    if (label) label.textContent = enabled ? 'Stop listening' : 'Voice commands';
  }

  function buildRecognition() {
    if (!Recognition || recognition) return recognition;
    recognition = new Recognition();
    recognition.lang = 'en-IN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      running = true;
      update('listening', 'Listening…', 'Try “what is ahead?”');
    };

    recognition.onresult = event => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const words = event.results[i][0]?.transcript?.trim() || '';
        if (event.results[i].isFinal) {
          update('processing', 'Command heard', `“${words}”`);
          void execute(words);
        } else interim += words + ' ';
      }
      if (interim.trim()) update('listening', 'Listening…', interim.trim());
    };

    recognition.onerror = event => {
      running = false;
      if (event.error === 'aborted' && pausedForSpeech) return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        enabled = false;
        update('error', 'Microphone permission was not allowed', 'Enable microphone access in your browser, then try again.');
        return;
      }
      if (event.error === 'audio-capture') {
        enabled = false;
        update('error', 'No microphone is available', 'Connect a microphone and try again.');
        return;
      }
      if (event.error !== 'no-speech' && event.error !== 'aborted')
        update('error', 'Voice recognition was interrupted', 'Select the microphone to try again.');
    };

    recognition.onend = () => {
      running = false;
      if (enabled && !pausedForSpeech) scheduleStart(300);
      else if (!enabled) update('off', 'Voice commands are off');
    };
    return recognition;
  }

  function start() {
    if (!enabled || pausedForSpeech || running) return;
    const engine = buildRecognition();
    if (!engine) return;
    try {
      engine.start();
      update('starting', 'Starting microphone…');
    } catch (error) {
      if (error.name !== 'InvalidStateError') {
        enabled = false;
        update('error', 'Could not start voice commands', 'Select the microphone to try again.');
      }
    }
  }

  function scheduleStart(delay = 0) {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(start, delay);
  }

  function turnOn() {
    if (!Recognition) {
      update('unsupported', 'Voice commands are unavailable in this browser', 'Use current Chrome or Edge, or use the on-screen controls.');
      return;
    }
    enabled = true;
    pausedForSpeech = false;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    start();
  }

  function turnOff(announce = false) {
    enabled = false;
    pausedForSpeech = false;
    clearTimeout(restartTimer);
    if (recognition && running) {
      try { recognition.abort(); } catch (_) {}
    }
    running = false;
    update('off', 'Voice commands are off');
    if (announce) app?.speak('Voice commands are off.');
  }

  function pauseForSpeech() {
    if (!enabled) return;
    pausedForSpeech = true;
    clearTimeout(restartTimer);
    update('speaking', 'Speaking response…');
    if (recognition && running) {
      try { recognition.abort(); } catch (_) {}
    }
  }

  function resumeAfterSpeech() {
    if (!enabled) return;
    pausedForSpeech = false;
    update('starting', 'Resuming listening…');
    scheduleStart(350);
  }

  function clean(input) {
    return String(input || '').toLowerCase().replace(/[?!.,'’]/g, '').replace(/\s+/g, ' ').trim();
  }

  const pageCommands = {
    'home': 'home', 'camera guide': 'camera', 'navigation': 'navigate',
    'navigate': 'navigate', 'around you': 'environment', 'read': 'read',
    'text reader': 'read', 'settings': 'settings', 'accessibility': 'accessibility',
    'journey history': 'activity', 'saved places': 'places',
    'emergency contacts': 'contacts', 'practice': 'practice', 'privacy': 'privacy'
  };

  async function execute(input) {
    const command = clean(input);
    if (!command || !app) return;

    if (/^(stop listening|turn off (voice|voice commands)|disable voice commands)$/.test(command)) {
      turnOff(true); return;
    }
    if (/^(voice help|what can i say|show (voice )?commands|help with voice commands)$/.test(command)) {
      app.help(); return;
    }
    if (/^(start|turn on|open) (the )?camera( guide)?$/.test(command)) {
      await app.startCamera(); return;
    }
    if (/^(stop|turn off|close) (the )?camera$/.test(command)) {
      app.stopCamera(); return;
    }
    if (/^(read (the )?(text|sign|label)|scan (the )?(text|sign|label)|read this)$/.test(command)) {
      await app.readText(); return;
    }
    if (/^(where am i|what is my location|current location)$/.test(command)) {
      app.whereAmI(); return;
    }
    if (/^(what(?:s| is) ahead|what(?:s| is) in front( of me)?|describe (my )?surroundings|what is around me|look ahead)$/.test(command)) {
      app.describeSurroundings(); return;
    }
    if (/^(navigate home|take me home|route home)$/.test(command)) {
      await app.navigateHome(); return;
    }
    const pageMatch = command.match(/^(?:open|show|go to) (.+)$/);
    if (pageMatch && pageCommands[pageMatch[1]]) {
      app.goTo(pageCommands[pageMatch[1]]); return;
    }
    const destination = command.match(/^(?:navigate|take me|go) to (.+)$/);
    if (destination) {
      await app.navigateTo(destination[1]); return;
    }
    const resultChoice = command.match(/^(?:select|choose) (?:result )?(\d+)$/) ||
      command.match(/^(?:select|choose) (first|second|third|fourth|fifth) result$/);
    if (resultChoice) {
      const words = { first:1, second:2, third:3, fourth:4, fifth:5 };
      const number = Number(resultChoice[1]) || words[resultChoice[1]];
      await window.navigationUI?.selectVoiceResult?.(number); return;
    }
    if (/^(begin|start) navigation$/.test(command)) {
      app.beginNavigation(); return;
    }
    if (/^(stop|end|cancel) navigation$/.test(command)) {
      if (window.navigationUI?.isActive?.()) window.navigationUI.stop();
      else app.speak('There is no active navigation to stop.');
      return;
    }
    if (/^(emergency|sos|help me)$/.test(command)) {
      app.emergency(); return;
    }
    if (/^(confirm emergency|confirm sos|activate (the )?(emergency|sos)( alert)?)$/.test(command)) {
      await app.confirmEmergency(); return;
    }
    if (/^(cancel emergency|cancel sos|stop (the )?(emergency|sos)( alert)?)$/.test(command)) {
      app.cancelEmergency(); return;
    }
    if (/^(repeat|say that again|repeat instruction|again)$/.test(command)) {
      app.repeat(); return;
    }
    if (/^(current instruction|what should i do|where am i going)$/.test(command)) {
      app.currentInstruction(); return;
    }

    const buttonMatch = command.match(/^(?:click|press|select) (.+)$/);
    if (buttonMatch && document.querySelectorAll) {
      const wanted = clean(buttonMatch[1]);
      const available = [...document.querySelectorAll('button:not([disabled])')].filter(button =>
        button.getClientRects?.().length || button.offsetParent !== null);
      const buttonName = button => clean(button.getAttribute('aria-label') || button.textContent);
      const chosen = available.find(button => buttonName(button) === wanted) ||
        available.find(button => buttonName(button).includes(wanted));
      if (chosen) {
        app.speak(`Selecting ${buttonMatch[1]}.`);
        chosen.click();
        return;
      }
    }

    update('listening', 'Command not recognised', `I heard “${input}”. Try “voice help”.`);
    app.speak('I did not recognise that command. Say voice help to hear the available commands.');
  }

  if (toggle) toggle.addEventListener('click', () => enabled ? turnOff() : turnOn());
  window.addEventListener?.('pagehide', () => turnOff());
  document.addEventListener?.('visibilitychange', () => {
    if (document.hidden) turnOff();
  });
  if (!Recognition) {
    if (toggle) toggle.disabled = true;
    update('unsupported', 'Voice commands are unavailable in this browser', 'Use current Chrome or Edge, or use the on-screen controls.');
  } else update('off', 'Voice commands are off');

  window.voiceCommandAPI = {
    start: turnOn,
    stop: turnOff,
    pauseForSpeech,
    resumeAfterSpeech,
    execute,
    isEnabled: () => enabled,
    isListening: () => running
  };
})();
