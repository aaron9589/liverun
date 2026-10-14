/**
 * Layout-wide configuration routes: GET/PUT /api/layout.
 *
 * The layout config describes the physical layout (JMRI connection, and in
 * later phases train profiles, boarding, events, LOA) and is shared by every
 * timetable. Stored and exchanged in snake_case, like timetable settings.
 * See docs/guard-panel-spec.md §4.
 */

const { validateSoundName } = require('./sounds');

const MODES = ['on', 'off', 'toggle', 'pulse', 'hold', 'on_for'];
const ACTION_RE = /^[a-z0-9_]{1,40}$/;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Only ws:// or wss:// URLs (or '' for "not configured"). */
function isWsUrlOrEmpty(value) {
  if (value === '') return true;
  try {
    return ['ws:', 'wss:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** '' (silent) or a valid sound file name. Existence is not checked: files may be uploaded later. */
function soundError(value, label) {
  if (typeof value !== 'string') return `${label} must be a string`;
  if (value === '') return null;
  const e = validateSoundName(value);
  return e ? `${label}: ${e}` : null;
}

function validateProfile(p, i, seen) {
  const at = `train_profiles[${i}]`;
  if (!isPlainObject(p)) return `${at} must be an object`;
  if (typeof p.id !== 'string' || !p.id.trim()) return `${at}.id must be a non-empty string`;
  if (seen.has(p.id)) return `${at}.id "${p.id}" is duplicated`;
  seen.add(p.id);
  if (typeof p.name !== 'string' || !p.name.trim()) return `${at}.name must be a non-empty string`;
  if (!Array.isArray(p.match) || p.match.some((m) => typeof m !== 'string')) return `${at}.match must be an array of strings`;
  if (!isPlainObject(p.sounds)) return `${at}.sounds must be an object`;
  for (const k of ['door_open', 'door_close', 'bell']) {
    const e = soundError(p.sounds[k], `${at}.sounds.${k}`);
    if (e) return e;
  }
  if (!isPlainObject(p.functions)) return `${at}.functions must be an object`;
  for (const [action, f] of Object.entries(p.functions)) {
    const fa = `${at}.functions.${action}`;
    if (!ACTION_RE.test(action)) return `${at}: action name "${action}" must be 1-40 characters of a-z, 0-9, _`;
    if (!isPlainObject(f)) return `${fa} must be an object`;
    if (!isPlainObject(f.key)) return `${fa}.key must be an object`;
    if ('fn' in f.key) {
      if (!Number.isInteger(f.key.fn) || f.key.fn < 0 || f.key.fn > 68) return `${fa}.key.fn must be an integer 0-68`;
    } else if (typeof f.key.label !== 'string' || !f.key.label.trim()) {
      return `${fa}.key must have an fn number or a non-empty label`;
    }
    if (!MODES.includes(f.mode)) return `${fa}.mode must be one of ${MODES.join(', ')}`;
    if (f.pulse_ms !== undefined && (!Number.isInteger(f.pulse_ms) || f.pulse_ms < 50 || f.pulse_ms > 10000)) {
      return `${fa}.pulse_ms must be an integer 50-10000`;
    }
    if (f.duration_s !== undefined && (typeof f.duration_s !== 'number' || !Number.isFinite(f.duration_s) || f.duration_s < 1 || f.duration_s > 300)) {
      return `${fa}.duration_s must be a number 1-300`;
    }
  }
  return null;
}

/**
 * Validates a PUT body. Returns { error } on the first problem found, or
 * { layout } with the sections it understands (getLayout/setLayout drop the rest).
 */
function validateLayout(body) {
  if (!isPlainObject(body)) return { error: 'Layout must be a JSON object' };

  if (body.jmri !== undefined) {
    if (!isPlainObject(body.jmri)) return { error: 'jmri must be an object' };
    const { url } = body.jmri;
    if (url !== undefined) {
      if (typeof url !== 'string') return { error: 'jmri.url must be a string' };
      if (!isWsUrlOrEmpty(url.trim())) return { error: 'jmri.url must use ws:// or wss://' };
      body.jmri.url = url.trim();
    }
  }

  if (body.guard !== undefined) {
    if (!isPlainObject(body.guard)) return { error: 'guard must be an object' };
    if (body.guard.event_alert_sound !== undefined) {
      const e = soundError(body.guard.event_alert_sound, 'guard.event_alert_sound');
      if (e) return { error: e };
    }
  }

  if (body.train_profiles !== undefined) {
    if (!Array.isArray(body.train_profiles)) return { error: 'train_profiles must be an array' };
    const seen = new Set();
    for (let i = 0; i < body.train_profiles.length; i++) {
      const e = validateProfile(body.train_profiles[i], i, seen);
      if (e) return { error: e };
    }
  }

  return { layout: body };
}

function register(app, { getLayout, setLayout }) {
  app.get('/api/layout', (_req, res) => {
    res.json(getLayout());
  });

  app.put('/api/layout', (req, res) => {
    const result = validateLayout(req.body);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(setLayout(result.layout));
  });
}

module.exports = { register, validateLayout };
