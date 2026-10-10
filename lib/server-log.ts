/**
 * Prepare a request or upstream derived value for a single server log line.
 *
 * Hosted logs are retained, so credentials are redacted before anything is
 * written: URLs (installer and Intune upload URLs can carry signed tokens),
 * Authorization schemes, JWTs, GitHub tokens, API key headers and credential
 * parameters in query, connection string, quoted, JSON and URL encoded form.
 * Control and line separator characters become spaces, so a value cannot
 * forge log lines. Invisible formatting characters (soft hyphen, zero width,
 * bidirectional, variation selectors, fillers and tag characters) are removed
 * so they cannot visually reorder a line or split a credential key from its
 * pattern; every rule also runs while they still act as separators, so
 * removing them cannot join a word to a secret either. The result is length
 * bounded.
 *
 * Values can be request supplied and arrive before truncation, so every
 * pattern must stay linear: no unbounded prefix before an anchor, and no two
 * adjacent quantifiers over overlapping character classes.
 */

// Credential key suffix. client_secret, access_token, api_key and x-api-key
// match through their suffix; the prefix stays in the text unchanged.
const CREDENTIAL_KEY = String.raw`(?:sig|token|secret|key|password|passwd|pwd)`;

// C0 and C1 controls plus Unicode line and paragraph separators.
const LINE_BREAKING_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
// Soft hyphen, combining grapheme joiner, Arabic letter mark, Mongolian vowel
// separator, zero width and bidirectional formatting, deprecated format
// characters, Hangul filler, variation selectors and BOM.
const INVISIBLE_CHARACTERS =
  /[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufe00-\ufe0f\ufeff]/g;
// Tag characters U+E0000 to U+E007F, written as surrogate pairs for ES2017.
const TAG_CHARACTERS = /\udb40[\udc00-\udc7f]/g;
// Every invisible character is first collapsed to this marker.
const INVISIBLE_MARKER = '\u200b';
const INVISIBLE_MARKERS = /\u200b/g;

// Rules that must also see an invisible character as a separator. The
// separator class and the first token character class are disjoint, and the
// Basic look ahead stops at the marker, so each rule stays linear.
const SEPARATOR_AWARE_REDACTIONS: Array<[RegExp, string]> = [
  [/\b(Bearer)[\s\u200b]+[\w.~+/-][\w.~+/\u200b-]*=*/gi, '$1 [redacted]'],
  // Basic credentials are base64 of at least four characters with an
  // uppercase letter, digit, plus or slash after the first character and a
  // lowercase letter or digit somewhere, or ending in padding that is not
  // followed by a quote. So "Basic Authentication", "Basic HTTP auth" and
  // `Basic realm="x"` stay readable. The scheme matches in any case, as HTTP
  // requires, while the value test stays case sensitive.
  [
    /\b([Bb][Aa][Ss][Ii][Cc])[\s\u200b]+(?:(?=[A-Za-z0-9+/]+[A-Z0-9+/])(?=[A-Z+/]*[a-z0-9])|(?=[A-Za-z0-9+/]+={1,2}(?![\w"'+/=])))[A-Za-z0-9+/]{4,}[A-Za-z0-9+/=\u200b]*/g,
    '$1 [redacted]',
  ],
  // JWS has three segments, JWE five; any further dot joined segments are
  // consumed too, so adjacent tokens cannot leave a segment behind.
  [/(^|[^\w-])eyJ[\w-]+(?:\.[\w-]+){2,}/g, '$1[redacted JWT]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '[redacted GitHub token]'],
  [/\bgithub_pat_\w+/g, '[redacted GitHub token]'],
];

const REDACTIONS: Array<[RegExp, string]> = [
  // Query and connection string form: sig=value, Pwd=value, password = value.
  // Runs before the URL rule so a value split from its key by a normalized
  // separator inside a URL is still redacted.
  // A value already replaced by an earlier pass is left as is.
  [new RegExp(String.raw`(${CREDENTIAL_KEY})\s*=\s*(?!\[redacted)[^\s&)"',;]+`, 'gi'), '$1=[redacted]'],
  // URL encoded form: sig%3Dvalue
  [new RegExp(String.raw`(${CREDENTIAL_KEY})%3D\s*(?!\[redacted)[^\s&%]+`, 'gi'), '$1%3D[redacted]'],
  [/https?:\/\/\S+/gi, '[redacted URL]'],
  // Runs again once invisible characters are removed, for a secret that an
  // invisible character split internally.
  ...SEPARATOR_AWARE_REDACTIONS,
  // JSON shaped: "client_secret": "value"
  [new RegExp(String.raw`(${CREDENTIAL_KEY})"(\s*:\s*)"(?:[^"\\]|\\.)*"`, 'gi'), '$1"$2"[redacted]"'],
  // Quoted values, which may contain spaces: password='p a s s', token: "x"
  [new RegExp(String.raw`(${CREDENTIAL_KEY})(\s*[=:]\s*)"[^"]*"`, 'gi'), '$1$2"[redacted]"'],
  [new RegExp(String.raw`(${CREDENTIAL_KEY})(\s*[=:]\s*)'[^']*'`, 'gi'), "$1$2'[redacted]'"],
  // Header form without quotes: x-api-key: value
  [/\b((?:x-)?api-key|ocp-apim-subscription-key)(\s*:\s*)(?!\[redacted)[^\s,;]+/gi, '$1$2[redacted]'],
];

function applyRedactions(text: string, redactions: Array<[RegExp, string]>): string {
  let result = text;
  for (const [pattern, replacement] of redactions) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function logValue(value: unknown, maxLength = 500): string {
  let text = String(value ?? '')
    .replace(TAG_CHARACTERS, INVISIBLE_MARKER)
    .replace(INVISIBLE_CHARACTERS, INVISIBLE_MARKER)
    .replace(LINE_BREAKING_CHARACTERS, ' ');
  // While invisible characters still separate words, run every rule, so
  // schemes and tokens cannot be joined to a preceding word and a URL is
  // redacted as a whole before any placeholder could split it.
  text = applyRedactions(text, REDACTIONS);
  // Then remove them, so they cannot split a credential key from its value
  // pattern, and run every rule on the result.
  text = applyRedactions(text.replace(INVISIBLE_MARKERS, ''), REDACTIONS).trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
