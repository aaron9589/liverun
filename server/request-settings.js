// Validation for the path-request keys of PUT /api/timetables/:id/settings (spec §7).

/**
 * Pick and validate the request settings present in a settings body.
 * Returns { values } with only the keys that were sent, or { error } for the first bad one.
 */
function parseRequestSettings(body) {
  const values = {};
  const { requests_enabled, request_train_prefix, request_default_leg_min, request_lead_min } = body || {};
  if (requests_enabled !== undefined) values.requests_enabled = Boolean(requests_enabled);
  if (request_train_prefix !== undefined) {
    const prefix = typeof request_train_prefix === 'string' ? request_train_prefix.trim() : '';
    if (!/^[A-Za-z0-9-]{1,8}$/.test(prefix)) {
      return { error: 'request_train_prefix must be 1-8 letters, digits or hyphens' };
    }
    values.request_train_prefix = prefix;
  }
  for (const [key, v, min, max] of [
    ['request_default_leg_min', request_default_leg_min, 1, 120],
    ['request_lead_min', request_lead_min, 0, 60],
  ]) {
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      return { error: `${key} must be an integer ${min}-${max}` };
    }
    values[key] = v;
  }
  return { values };
}

module.exports = { parseRequestSettings };
