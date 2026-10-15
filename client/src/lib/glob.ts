/**
 * Case-insensitive globs used across layout config (train profiles, boarding
 * rules, LOA filters): `*` matches any run of characters, `?` exactly one.
 * Everything else is literal.
 */
export function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .split('')
    .map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`, 'i');
}

export function globMatch(pattern: string, value: string): boolean {
  return globToRegExp(pattern.trim()).test(value.trim());
}

/** True when any non-blank pattern matches. */
export function globMatchAny(patterns: string[], value: string): boolean {
  return patterns.some((p) => p.trim() !== '' && globMatch(p, value));
}
