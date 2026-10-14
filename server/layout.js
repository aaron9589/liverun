/**
 * Layout-wide configuration routes: GET/PUT /api/layout.
 *
 * The layout config describes the physical layout (JMRI connection, and in
 * later phases train profiles, boarding, events, LOA) and is shared by every
 * timetable. Stored and exchanged in snake_case, like timetable settings.
 * See docs/guard-panel-spec.md §4.
 */

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
