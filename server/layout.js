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


// ── Boarding (spec §8) and stats (spec §9) ─────────────────────────────────

const HHMM_RE = /^(\d{1,2}):(\d{2})$/;

/** "HH:MM" within 00:00-24:00 (24:00 allowed only exactly). */
function isClock(v) {
  if (typeof v !== 'string') return false;
  const m = HHMM_RE.exec(v.trim());
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return min <= 59 && (h < 24 || (h === 24 && min === 0));
}

function numberIn(v, min, max, label) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return `${label} must be a number`;
  if (v < min || v > max) return `${label} must be between ${min} and ${max}`;
  return null;
}

function validateRange(v, min, max, label) {
  if (!Array.isArray(v) || v.length !== 2) return `${label} must be a [min, max] pair`;
  const e = numberIn(v[0], min, max, `${label}[0]`) || numberIn(v[1], min, max, `${label}[1]`);
  if (e) return e;
  return v[0] > v[1] ? `${label}: min must not exceed max` : null;
}

const RULE_TEXT_KEYS = ['direction', 'train_id', 'train_name'];

function validateBoardingModel(m, at) {
  if (!isPlainObject(m)) return `${at} must be an object`;
  let e;
  if (m.max_passengers !== undefined && (e = numberIn(m.max_passengers, 0, 1000, `${at}.max_passengers`))) return e;
  if (m.spread !== undefined && (e = numberIn(m.spread, 0, 2, `${at}.spread`))) return e;
  if (m.demand_curve !== undefined) {
    const c = m.demand_curve;
    if (!Array.isArray(c) || c.length === 0) return `${at}.demand_curve must be an array with at least one point`;
    for (let i = 0; i < c.length; i++) {
      const p = c[i];
      if (!Array.isArray(p) || p.length !== 2) return `${at}.demand_curve[${i}] must be ["HH:MM", factor]`;
      if (!isClock(p[0])) return `${at}.demand_curve[${i}]: time must be HH:MM between 00:00 and 24:00`;
      if ((e = numberIn(p[1], 0, Infinity, `${at}.demand_curve[${i}] factor`))) return e;
    }
  }
  if (m.rules !== undefined) {
    if (!Array.isArray(m.rules)) return `${at}.rules must be an array`;
    for (let i = 0; i < m.rules.length; i++) {
      const r = m.rules[i];
      const ra = `${at}.rules[${i}]`;
      if (!isPlainObject(r)) return `${ra} must be an object`;
      if (typeof r.name !== 'string') return `${ra}.name must be a string`;
      if ((e = numberIn(r.factor, 0, Infinity, `${ra}.factor`))) return e;
      if (!isPlainObject(r.when)) return `${ra}.when must be an object`;
      for (const [k, v] of Object.entries(r.when)) {
        if (RULE_TEXT_KEYS.includes(k)) {
          if (typeof v !== 'string') return `${ra}.when.${k} must be a string`;
        } else if (k === 'from' || k === 'to') {
          if (!isClock(v)) return `${ra}.when.${k} must be HH:MM`;
        } else {
          return `${ra}.when has unknown key "${k}"`;
        }
      }
    }
  }
  if (m.position !== undefined) {
    if (!isPlainObject(m.position)) return `${at}.position must be an object`;
    for (const k of ['origin', 'intermediate', 'terminus']) {
      if (m.position[k] !== undefined && (e = numberIn(m.position[k], 0, Infinity, `${at}.position.${k}`))) return e;
    }
  }
  return null;
}

function validateBoarding(b) {
  if (!isPlainObject(b)) return 'boarding must be an object';
  let e = validateBoardingModel(b, 'boarding');
  if (e) return e;
  const nums = [
    ['tick_s', 0.1, 10], ['jitter', 0, 1], ['flow_rate', 0.1, 100], ['straggler_threshold', 0, 100],
    ['straggler_rate', 0.1, 100], ['runner_chance', 0, 1], ['start_delay_s', 0, 60], ['doil_off_delay_s', 0, 60],
  ];
  for (const [k, lo, hi] of nums) {
    if (b[k] !== undefined && (e = numberIn(b[k], lo, hi, `boarding.${k}`))) return e;
  }
  if (b.runner_count !== undefined && (e = validateRange(b.runner_count, 0, 100, 'boarding.runner_count'))) return e;
  if (b.runner_delay_s !== undefined && (e = validateRange(b.runner_delay_s, 0, 60, 'boarding.runner_delay_s'))) return e;
  if (b.show_alighting !== undefined && typeof b.show_alighting !== 'boolean') return 'boarding.show_alighting must be true or false';
  if (b.alighting !== undefined) return validateBoardingModel(b.alighting, 'boarding.alighting');
  return null;
}

const STATS_PLACEHOLDERS = ['train', 'trainId', 'station'];

function validateStats(s) {
  if (!isPlainObject(s)) return 'stats must be an object';
  if (s.enabled !== undefined && typeof s.enabled !== 'boolean') return 'stats.enabled must be true or false';
  if (s.topic !== undefined) {
    if (typeof s.topic !== 'string') return 'stats.topic must be a string';
    if (s.topic.length > 200) return 'stats.topic must be 200 characters or fewer';
    for (const m of s.topic.matchAll(/\{([^{}]*)\}/g)) {
      if (!STATS_PLACEHOLDERS.includes(m[1])) return `stats.topic: unknown placeholder {${m[1]}} (use ${STATS_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')})`;
    }
    const bare = s.topic.replace(/\{[^{}]*\}/g, '');
    if (/[+#]/.test(bare)) return 'stats.topic must not contain MQTT wildcards (+ or #)';
    if (/[{}]/.test(bare)) return 'stats.topic has an unmatched brace';
  }
  if (s.payload !== undefined && !['count', 'json'].includes(s.payload)) return 'stats.payload must be "count" or "json"';
  if (s.publish_on !== undefined && !['boarding_start', 'door_close'].includes(s.publish_on)) {
    return 'stats.publish_on must be "boarding_start" or "door_close"';
  }
  // A partial body that omits topic keeps the stored one (merged by setLayout), so only an explicit empty topic is an error.
  if (s.enabled === true && s.topic !== undefined && !s.topic.trim()) return 'stats.topic is required when stats are enabled';
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

  if (body.boarding !== undefined) {
    const e = validateBoarding(body.boarding);
    if (e) return { error: e };
  }

  if (body.stats !== undefined) {
    const e = validateStats(body.stats);
    if (e) return { error: e };
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
