/**
 * Helpers for building PostgREST filter strings by hand (the argument to
 * `.or()`, which supabase-js passes through verbatim).
 *
 * PostgREST parses that argument as a logic tree: commas separate the
 * operands and parentheses group them. Any value interpolated into it must
 * therefore be double-quoted, or a name as ordinary as
 * "Docubizz -TCK Arhus, Randers & Hobro" splits the tree and the whole query
 * fails with "failed to parse logic tree". Inside double quotes, backslash
 * and double quote are the only characters that still need escaping, and
 * backslashes must be escaped first so an input ending in one cannot break
 * out of the quotes.
 */

/** Quote and escape a single value for use inside a PostgREST filter. */
export function quotePostgrestValue(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Build a quoted `%term%` pattern for an ilike filter.
 *
 * Quoting protects PostgREST's parser without disabling LIKE semantics, so
 * the surrounding `%` still match as wildcards. Any `%` or `_` inside the
 * term keeps its existing wildcard meaning; that only widens the match and
 * is unchanged from the previous unquoted behaviour.
 */
export function quotePostgrestLikePattern(term: string): string {
  return quotePostgrestValue(`%${term}%`);
}
