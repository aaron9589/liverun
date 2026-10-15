/**
 * Guard events (spec §10): validation of per-stop placements and the layout
 * event library. Hidden from crews: nothing here is ever returned by the live
 * station board / feed (those build their own objects).
 */

const MAX_MESSAGE = 500;
const TRIGGERS = ['door_open', 'boarding_done', 'door_close'];
const KINDS = ['station', 'enroute'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function messagesError(m, label) {
  if (!Array.isArray(m) || m.length === 0) return `${label} must be a non-empty array`;
  for (const x of m) {
    if (typeof x !== 'string' || !x.trim()) return `${label} must contain only non-empty strings`;
    if (x.length > MAX_MESSAGE) return `${label} entries must be ${MAX_MESSAGE} characters or fewer`;
  }
  return null;
}

function rangeError(v, lo, hi, label) {
  if (!Array.isArray(v) || v.length !== 2) return `${label} must be a [min, max] pair`;
  for (const n of v) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) return `${label} values must be numbers between ${lo} and ${hi}`;
  }
  return v[0] > v[1] ? `${label}: min must not exceed max` : null;
}

/** Returns an error string or null. */
function validatePlacement(p, label, seenIds) {
  if (!isPlainObject(p)) return `${label} must be an object`;
  if (typeof p.id !== 'string' || !p.id.trim()) return `${label}.id must be a non-empty string`;
  if (seenIds.has(p.id)) return `${label}.id "${p.id}" is duplicated within the stop`;
  seenIds.add(p.id);
  const hasLib = p.event !== undefined && p.event !== null;
  let kind = null;
  if (hasLib) {
    if (typeof p.event !== 'string' || !p.event.trim()) return `${label}.event must be a library event id`;
    if (p.kind !== undefined && p.kind !== null) return `${label}.kind is only for inline events`;
    if (p.messages !== undefined && p.messages !== null) {
      const e = messagesError(p.messages, `${label}.messages`);
      if (e) return e;
    }
    // A library event's kind is resolved by the panel; the checks below that need a kind are skipped.
  } else {
    if (!KINDS.includes(p.kind)) return `${label}.kind must be "station" or "enroute"`;
    kind = p.kind;
    const e = messagesError(p.messages, `${label}.messages`);
    if (e) return e;
  }
  if (typeof p.probability !== 'number' || !Number.isFinite(p.probability) || p.probability < 0 || p.probability > 1) {
    return `${label}.probability must be a number between 0 and 1`;
  }
  const hasStation = p.trigger !== undefined || p.delay_s !== undefined;
  const hasEnroute = p.at !== undefined;
  if (kind === 'station' && hasEnroute) return `${label}: "at" is only for en-route events`;
  if (kind === 'enroute' && hasStation) return `${label}: trigger/delay_s are only for station events`;
  if (hasStation && hasEnroute) return `${label}: cannot combine trigger/delay_s with at`;
  if (p.trigger !== undefined && !TRIGGERS.includes(p.trigger)) return `${label}.trigger must be one of ${TRIGGERS.join(', ')}`;
  if (p.delay_s !== undefined) {
    const e = rangeError(p.delay_s, 0, 600, `${label}.delay_s`);
    if (e) return e;
  }
  if (p.at !== undefined) {
    const e = rangeError(p.at, 0, 1, `${label}.at`);
    if (e) return e;
  }
  return null;
}

/** Clean copy of a validated placement (known fields only). */
function cleanPlacement(p) {
  const out = { id: p.id, probability: p.probability };
  if (p.event != null) out.event = p.event;
  if (p.kind != null) out.kind = p.kind;
  if (Array.isArray(p.messages)) out.messages = p.messages.map((m) => m.trim());
  if (p.trigger !== undefined) out.trigger = p.trigger;
  if (p.delay_s !== undefined) out.delay_s = [p.delay_s[0], p.delay_s[1]];
  if (p.at !== undefined) out.at = [p.at[0], p.at[1]];
  return out;
}

/** Validates the camelCase `guardEvents` of every stop in a train request. Returns { error } or { ok: true }. */
function validateStopsEvents(stops) {
  if (!Array.isArray(stops)) return { ok: true };
  for (let i = 0; i < stops.length; i++) {
    const g = stops[i] && stops[i].guardEvents;
    if (g === undefined || g === null) continue;
    if (!Array.isArray(g)) return { error: `stops[${i}].guardEvents must be an array` };
    const seen = new Set();
    for (let j = 0; j < g.length; j++) {
      const e = validatePlacement(g[j], `stops[${i}].guardEvents[${j}]`, seen);
      if (e) return { error: e };
    }
  }
  return { ok: true };
}

/** Cleaned placements, or undefined when empty. Invalid entries are dropped (used when copying stops). */
function sanitizePlacements(list) {
  if (!Array.isArray(list)) return undefined;
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!validatePlacement(p, 'p', seen)) out.push(cleanPlacement(p));
  }
  return out.length ? out : undefined;
}

const EVENT_ID_RE = /^[a-z0-9_-]+$/;

/** Layout events section. `soundError(value, label)` and `actionRe` come from layout.js. */
function validateEventsConfig(ev, soundError, actionRe) {
  if (!isPlainObject(ev)) return 'events must be an object';
  if (ev.library !== undefined) {
    if (!Array.isArray(ev.library)) return 'events.library must be an array';
    const seen = new Set();
    for (let i = 0; i < ev.library.length; i++) {
      const d = ev.library[i];
      const at = `events.library[${i}]`;
      if (!isPlainObject(d)) return `${at} must be an object`;
      if (typeof d.id !== 'string' || !EVENT_ID_RE.test(d.id)) return `${at}.id must be non-empty and use only a-z, 0-9, - and _`;
      if (seen.has(d.id)) return `${at}.id "${d.id}" is duplicated`;
      seen.add(d.id);
      if (typeof d.name !== 'string' || !d.name.trim()) return `${at}.name must be a non-empty string`;
      if (!KINDS.includes(d.kind)) return `${at}.kind must be "station" or "enroute"`;
      const me = messagesError(d.messages, `${at}.messages`);
      if (me) return me;
      const se = soundError(d.sound === undefined ? '' : d.sound, `${at}.sound`);
      if (se) return se;
      if (d.action !== undefined && d.action !== '' && (typeof d.action !== 'string' || !actionRe.test(d.action))) {
        return `${at}.action must be 1-40 characters of a-z, 0-9, _`;
      }
    }
  }
  if (ev.publish_topic !== undefined) {
    if (typeof ev.publish_topic !== 'string') return 'events.publish_topic must be a string';
    if (ev.publish_topic.length > 200) return 'events.publish_topic must be 200 characters or fewer';
    if (/[+#]/.test(ev.publish_topic)) return 'events.publish_topic must not contain MQTT wildcards (+ or #)';
  }
  return null;
}

module.exports = {
  validateStopsEvents, validatePlacement, sanitizePlacements,
  validateEventsConfig,
};
