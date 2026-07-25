// Shared validation + merge for the fire config draft {event, app, timeline}.
// Used by the local dev server (tools/dev_server.js).

function isDivisorOf24(value) {
  return Number.isInteger(value) && value > 0 && 24 % value === 0;
}

/**
 * Normalize user-supplied display text: drop control characters, collapse
 * whitespace, clamp length.
 *
 * Markup characters are deliberately preserved. The frontend renders these via
 * `textContent` and the bootstrap island is JSON-escaped, so stripping them
 * buys no safety while corrupting legitimate names ("Bear & Fox Creek").
 */
function cleanText(value, maxLength = 160) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Returns an error string, or null when the draft is valid. */
function validateDraft(draft) {
  if (typeof draft !== 'object' || draft === null) return 'Body must be a JSON object.';
  const { event, app, timeline } = draft;
  if (!event || !Array.isArray(event.center) || event.center.length !== 2) return 'event.center must be [lng, lat].';
  if (!event.center.every((n) => Number.isFinite(n))) return 'event.center must be numbers.';
  if (Math.abs(event.center[0]) > 180 || event.center[1] < -90 || event.center[1] > 90) return 'event.center is out of range.';
  if (!Array.isArray(event.bounds) || event.bounds.length !== 4) return 'event.bounds must be [w, s, e, n].';
  if (!event.bounds.every((n) => Number.isFinite(n))) return 'event.bounds must be numbers.';
  if (event.bounds[0] >= event.bounds[2] || event.bounds[1] >= event.bounds[3]) return 'Bounds must be west < east and south < north.';
  if (typeof event.name !== 'string' || !event.name.trim()) return 'event.name is required.';
  if (!app || !app.baseImagery || !Array.isArray(app.baseImagery.tiles) || !app.baseImagery.tiles[0]) return 'app.baseImagery.tiles[0] is required.';
  if (!timeline) return 'timeline is required.';
  const start = Date.parse(timeline.startAt);
  const end = Date.parse(timeline.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return 'timeline start must be a valid time before end.';
  if (!isDivisorOf24(timeline.cadenceHours)) return 'timeline.cadenceHours must be a positive divisor of 24.';
  return null;
}

/** Merge {event, app, timeline} onto an existing config, preserving feeds. */
function mergeConfig(existing, draft) {
  const app = { ...existing.app, ...draft.app };
  app.title = cleanText(app.title);
  app.tagline = cleanText(app.tagline);
  if (app.baseImagery) {
    app.baseImagery = { ...app.baseImagery, attribution: cleanText(app.baseImagery.attribution) };
  }
  return {
    ...existing,
    event: { ...existing.event, ...draft.event, name: cleanText(draft.event.name ?? existing.event.name) },
    app,
    timeline: { ...draft.timeline },
    updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  };
}

module.exports = { validateDraft, mergeConfig, cleanText, isDivisorOf24 };
