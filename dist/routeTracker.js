(function () {
  'use strict';

  const R = 6371000;
  const rad = value => value * Math.PI / 180;
  function distance(a, b) {
    const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function closestOnSegment(point, a, b) {
    const lat = rad((a[1] + b[1] + point[1]) / 3);
    const scaleX = Math.cos(lat), ax = a[0] * scaleX, ay = a[1], bx = b[0] * scaleX, by = b[1];
    const px = point[0] * scaleX, py = point[1], dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const snapped = [(ax + t * dx) / scaleX, ay + t * dy];
    return { t, snapped, distance: distance(point, snapped) };
  }

  class RouteTracker {
    constructor(route, options = {}) {
      this.route = route;
      this.offRouteConfirmations = options.offRouteConfirmations || 3;
      this.maxUsableAccuracy = options.maxUsableAccuracy || 80;
      this.offRouteCount = 0;
      this.lastAlong = 0;
      this.lengths = [0];
      for (let i = 1; i < route.coordinates.length; i++)
        this.lengths[i] = this.lengths[i - 1] + distance(route.coordinates[i - 1], route.coordinates[i]);
      this.total = this.lengths.at(-1) || route.distance || 0;
    }

    update(location) {
      const point = [location.longitude, location.latitude];
      let best = { distance: Infinity, segment: 0, t: 0, snapped: point };
      this.route.coordinates.forEach((coord, index, points) => {
        if (!index) return;
        const candidate = closestOnSegment(point, points[index - 1], coord);
        if (candidate.distance < best.distance) best = { ...candidate, segment: index - 1 };
      });
      const segmentLength = this.lengths[best.segment + 1] - this.lengths[best.segment];
      const accuracy = Number(location.accuracy) || Infinity;
      const usableAccuracy = accuracy <= this.maxUsableAccuracy;
      const rawAlong = this.lengths[best.segment] + segmentLength * best.t;
      const along = usableAccuracy && rawAlong + 15 >= this.lastAlong ? Math.max(this.lastAlong, rawAlong) : this.lastAlong;
      this.lastAlong = Math.min(this.total, along);
      const threshold = Math.max(30, Math.min(65, accuracy * 1.5));
      if (accuracy <= this.maxUsableAccuracy && best.distance > threshold) this.offRouteCount++;
      else if (best.distance <= threshold) this.offRouteCount = 0;

      const nearestIndex = best.segment + (best.t > .5 ? 1 : 0);
      let stepIndex = Math.max(0, this.route.steps.findIndex(step => Number(step.interval?.[1]) >= nearestIndex));
      if (stepIndex < 0) stepIndex = Math.max(0, this.route.steps.length - 1);
      const step = this.route.steps[stepIndex] || { text: 'Continue straight', interval: [nearestIndex, nearestIndex] };
      const nextStep = this.route.steps[stepIndex + 1] || null;
      const maneuverIndex = Math.min(this.route.coordinates.length - 1,
        nextStep ? Number(nextStep.interval?.[0]) || nearestIndex : Number(step.interval?.[1]) || nearestIndex);
      const distanceToManeuver = Math.max(0, (this.lengths[maneuverIndex] || this.lastAlong) - this.lastAlong);
      const remaining = Math.max(0, this.total - this.lastAlong);

      return {
        snapped: best.snapped, distanceFromRoute: best.distance,
        usableAccuracy,
        along: this.lastAlong, remaining, progress: this.total ? this.lastAlong / this.total : 0,
        nearestIndex, stepIndex, step, nextStep, displayStep: nextStep && distanceToManeuver <= 55 ? nextStep : step, distanceToManeuver,
        arrived: remaining <= 15 && best.distance <= threshold,
        shouldReroute: this.offRouteCount >= this.offRouteConfirmations
      };
    }

    resetOffRoute() { this.offRouteCount = 0; }
  }

  window.VisionGuideNavigation = { ...(window.VisionGuideNavigation || {}), RouteTracker, routeDistance: distance };
})();
