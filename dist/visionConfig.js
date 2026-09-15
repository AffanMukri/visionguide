(function () {
  'use strict';

  const config = {
    debug: false,
    camera: {
      width: 1280,
      height: 720,
      facingMode: 'environment'
    },
    detection: {
      intervalMs: 900,
      errorBackoffMs: 1800,
      minConfidence: 0.45,
      maxBoxes: 20,
      staleAfterMs: 5000
    },
    tracker: {
      highThreshold: 0.45,
      lowThreshold: 0.15,
      highIou: 0.30,
      lowIou: 0.50,
      recoveryIou: 0.45,
      minHits: 2,
      maxLostAge: 8
    },
    depth: {
      intervalMs: 3000,
      maxInputEdge: 518,
      staleAfterMs: 6500,
      lowQuantile: 0.05,
      highQuantile: 0.95,
      trackSmoothing: 0.55
    },
    freeSpace: {
      columns: 5,
      rows: 3,
      detectionOverlap: 0.20,
      smoothing: 0.55,
      obstacleThreshold: 0.62,
      cautionThreshold: 0.26,
      depthObstacleDelta: 0.24,
      depthCautionDelta: 0.12
    },
    risk: {
      mediumThreshold: 38,
      highThreshold: 68,
      historyFrames: 6,
      historyMs: 8000,
      directionMargin: 12,
      directionSwitchMargin: 10,
      directionConfirmFrames: 2,
      blockedFreePercent: 35,
      directionRepeatMs: 7000
    },
    guidance: {
      queueLimit: 8,
      maxAgeMs: 5000,
      objectCooldownMs: 9000,
      directionCooldownMs: 6500,
      ocrCooldownMs: 7000
    },
    ocr: {
      autoIntervalMs: 3500,
      historyMax: 5,
      minConfidence: 40,
      minTextLength: 2,
      maxCapturePixels: 1200000,
      historyDuplicateMs: 30000,
      repeatCooldownMs: 7000
    }
  };

  function deepFreeze(value) {
    Object.values(value).forEach(child => {
      if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
    });
    return Object.freeze(value);
  }

  window.VisionGuideConfig = deepFreeze(config);
})();
