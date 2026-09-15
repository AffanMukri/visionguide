(function () {
  'use strict';

  const cfg = window.VisionGuideConfig?.guidance || {};
  const maxQueue = cfg.queueLimit || 8;
  const maxAge = cfg.maxAgeMs || 5000;
  const recent = new Map();
  let queue = [];
  let active = null;
  let player = null;
  let cancelPlayer = null;
  let sequence = 0;

  function configure(options) {
    player = options?.player || player;
    cancelPlayer = options?.cancel || cancelPlayer;
    _pump();
  }

  function announce(text, options = {}) {
    text = String(text || '').trim();
    if (!text) return Promise.resolve(false);
    const now = Date.now();
    const key = String(options.key || text.toLowerCase());
    const cooldownMs = Math.max(0, Number(options.cooldownMs) || 0);
    if (cooldownMs && now - (recent.get(key) || 0) < cooldownMs) return Promise.resolve(false);
    if (active?.key === key || queue.some(item => item.key === key)) return Promise.resolve(false);
    recent.set(key, now);

    return new Promise(resolve => {
      const item = {
        text, key, resolve, createdAt: now, sequence: sequence++,
        priority: Number(options.priority) || 50,
        interrupt: Boolean(options.interrupt),
        maxAgeMs: Number(options.maxAgeMs) || maxAge
      };
      queue.push(item);
      queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
      if (queue.length > maxQueue) {
        const dropped = queue.pop();
        dropped.resolve(false);
      }
      if (active && item.interrupt && item.priority > active.priority) {
        const retained = [];
        queue.forEach(pending => {
          if (pending.priority >= item.priority || pending === item) retained.push(pending);
          else pending.resolve(false);
        });
        queue = retained;
        cancelPlayer?.();
      }
      _pump();
    });
  }

  async function _pump() {
    if (active || !player) return;
    const now = Date.now();
    while (queue.length && now - queue[0].createdAt > queue[0].maxAgeMs) queue.shift().resolve(false);
    const item = queue.shift();
    if (!item) return;
    active = item;
    let played = false;
    try { played = await player(item.text); }
    catch (error) {
      if (window.VisionGuideConfig?.debug) console.warn('[VisionGuide guidance]', error);
    }
    if (active === item) active = null;
    item.resolve(Boolean(played));
    _pruneRecent();
    _pump();
  }

  function clear(options = {}) {
    const below = Number.isFinite(options.belowPriority) ? options.belowPriority : Infinity;
    const retained = [];
    queue.forEach(item => item.priority < below ? item.resolve(false) : retained.push(item));
    queue = retained;
    if (options.cancelActive && active && active.priority < below) cancelPlayer?.();
  }

  function _pruneRecent() {
    const cutoff = Date.now() - 60000;
    recent.forEach((time, key) => { if (time < cutoff) recent.delete(key); });
  }

  window.guidanceAPI = {
    configure,
    announce,
    clear,
    stop: () => { clear(); cancelPlayer?.(); },
    getState: () => ({ speaking: Boolean(active), queued: queue.length, activePriority: active?.priority || null })
  };
})();
