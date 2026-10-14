/**
 * Validation for `layout.loa` (Limit of Authority, spec §11). Returns an error
 * string, or null when valid. Pure; no I/O.
 */

const MAX_SECTIONS = 200;
const MAX_ELEMENTS = 50;
const MAX_OPTIONS = 20;
const MAX_VALUES = 50;
const MAX_GLOBS = 50;
const MAX_STR = 200;
const MAX_TOPIC = 300;

const TYPES = ['signal', 'token', 'condition', 'selector'];
const CONDITION_TYPES = ['signal', 'token', 'condition'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function nonEmptyString(v, max) {
  return typeof v === 'string' && v.trim() !== '' && v.length <= max;
}

function stringList(v, at, { max = MAX_VALUES, maxLen = MAX_STR } = {}) {
  if (!Array.isArray(v)) return `${at} must be an array of strings`;
  if (v.length > max) return `${at} may have at most ${max} entries`;
  for (const s of v) {
    if (typeof s !== 'string') return `${at} must contain only strings`;
    if (s.length > maxLen) return `${at} entries must be ${maxLen} characters or fewer`;
  }
  return null;
}

function validateTopic(topic, at) {
  if (!nonEmptyString(topic, MAX_TOPIC)) return `${at}.topic is required (up to ${MAX_TOPIC} characters)`;
  if (/[+#]/.test(topic)) return `${at}.topic must not contain MQTT wildcards (+ or #)`;
  return null;
}

function validateCondition(el, at) {
  let e;
  if (!CONDITION_TYPES.includes(el.type)) return `${at}.type must be signal, token or condition`;
  if (!nonEmptyString(el.label, MAX_STR)) return `${at}.label is required (up to ${MAX_STR} characters)`;
  if ((e = validateTopic(el.topic, at))) return e;
  if ((e = stringList(el.clear, `${at}.clear`))) return e;
  if (!el.clear.some((s) => s.trim() !== '')) return `${at}.clear needs at least one non-blank value`;
  if (el.caution !== undefined && (e = stringList(el.caution, `${at}.caution`))) return e;
  if (el.revokes !== undefined && typeof el.revokes !== 'boolean') return `${at}.revokes must be true or false`;
  return null;
}

function validateElement(el, at) {
  if (!isPlainObject(el)) return `${at} must be an object`;
  if (!TYPES.includes(el.type)) return `${at}.type must be signal, token, condition or selector`;
  if (el.type !== 'selector') return validateCondition(el, at);

  let e;
  if (!nonEmptyString(el.label, MAX_STR)) return `${at}.label is required (up to ${MAX_STR} characters)`;
  if ((e = validateTopic(el.topic, at))) return e;
  if (!isPlainObject(el.options)) return `${at}.options must be an object`;
  const keys = Object.keys(el.options);
  if (keys.length === 0) return `${at}.options needs at least one option`;
  if (keys.length > MAX_OPTIONS) return `${at}.options may have at most ${MAX_OPTIONS} options`;
  for (const k of keys) {
    if (k.trim() === '' || k.length > MAX_STR) return `${at}.options keys must be non-blank values up to ${MAX_STR} characters`;
    const o = el.options[k];
    if (!isPlainObject(o)) return `${at}.options["${k}"] must be an object`;
    if (o.type === 'selector') return `${at}.options["${k}"] must be a condition, not a nested selector`;
    if ((e = validateCondition(o, `${at}.options["${k}"]`))) return e;
  }
  if (typeof el.default !== 'string' || !keys.includes(el.default)) return `${at}.default must be one of the option keys`;
  return null;
}

function validateSection(s, i, ids) {
  const at = `loa.sections[${i}]`;
  let e;
  if (!isPlainObject(s)) return `${at} must be an object`;
  if (!nonEmptyString(s.id, MAX_STR)) return `${at}.id is required`;
  if (ids.has(s.id)) return `${at}.id "${s.id}" is not unique`;
  ids.add(s.id);
  if (!nonEmptyString(s.name, MAX_STR)) return `${at}.name is required (up to ${MAX_STR} characters)`;
  if (!nonEmptyString(s.from, MAX_STR)) return `${at}.from is required`;
  if (!nonEmptyString(s.to, MAX_STR)) return `${at}.to is required`;
  if (s.from.trim().toLowerCase() === s.to.trim().toLowerCase()) return `${at}: from and to must be different stations`;
  for (const k of ['only', 'except']) {
    if ((e = stringList(s[k], `${at}.${k}`, { max: MAX_GLOBS }))) return e;
  }
  if (!Array.isArray(s.elements)) return `${at}.elements must be an array`;
  if (s.elements.length > MAX_ELEMENTS) return `${at}.elements may have at most ${MAX_ELEMENTS} entries`;
  for (let j = 0; j < s.elements.length; j++) {
    if ((e = validateElement(s.elements[j], `${at}.elements[${j}]`))) return e;
  }
  return null;
}

function validateLoaConfig(loa) {
  if (!isPlainObject(loa)) return 'loa must be an object';
  if (loa.warn_on_depart !== undefined && typeof loa.warn_on_depart !== 'boolean') return 'loa.warn_on_depart must be true or false';
  if (loa.sections === undefined) return null;
  if (!Array.isArray(loa.sections)) return 'loa.sections must be an array';
  if (loa.sections.length > MAX_SECTIONS) return `loa.sections may have at most ${MAX_SECTIONS} entries`;
  const ids = new Set();
  for (let i = 0; i < loa.sections.length; i++) {
    const e = validateSection(loa.sections[i], i, ids);
    if (e) return e;
  }
  return null;
}

module.exports = { validateLoaConfig };
