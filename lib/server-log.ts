/**
 * Prepare a request or upstream derived value for a single server log line.
 *
 * Hosted logs are retained, so credentials are redacted before anything is
 * written: URLs (installer and Intune upload URLs can carry signed tokens),
 * Authorization schemes, JWTs, GitHub tokens, API key headers and credential
 * parameters in query, connection string, quoted, JSON and URL encoded form.
 * Control and line separator characters are replaced and invisible formatting
 * characters removed, so a value cannot forge, visually reorder or split log
 * content, and the result is length bounded.
 *
 * Values can be request supplied and arrive before truncation, so every
 * pattern must stay linear: no unbounded prefix before an anchor.
 */

// Credential key suffix. client_secret, access_token, api_key and x-api-key
// match through their suffix; the prefix stays in the text unchanged.
const CREDENTIAL_KEY = String.raw`(?:sig|token|secret|key|password|passwd|pwd)`;

// C0 and C1 controls plus Unicode line and paragraph separators.
const LINE_BREAKING_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
// Soft hyphen, zero width and bidirectional formatting characters, and BOM.
const INVISIBLE_CHARACTERS = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

const REDACTIONS: Array<[RegExp, string]> = [
  // Query and connection string form: sig=value, Pwd=value, password = value.
  // Runs before the URL rule so a value split from its key by a normalized
  // separator inside a URL is still redacted.
  [new RegExp(String.raw`(${CREDENTIAL_KEY})\s*=\s*[^\s&)"',;]+`, 'gi'), '$1=[redacted]'],
  // URL encoded form: sig%3Dvalue
  [new RegExp(String.raw`(${CREDENTIAL_KEY})%3D\s*[^\s&%]+`, 'gi'), '$1%3D[redacted]'],
  [/https?:\/\/\S+/gi, '[redacted URL]'],
  [/\b(Bearer)\s+[\w.~+/-]+=*/gi, '$1 [redacted]'],
  // Basic credentials are base64 with at least one digit, plus, slash or
  // padding, so prose such as "Basic authentication" stays readable.
  [/\b(Basic)\s+(?=[A-Za-z0-9+/]*[0-9+/=])[A-Za-z0-9+/]{8,}={0,2}/gi, '$1 [redacted]'],
  [/(^|[^\w-])eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '$1[redacted JWT]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '[redacted GitHub token]'],
  [/\bgithub_pat_\w+/g, '[redacted GitHub token]'],
  // JSON shaped: "client_secret": "value"
  [new RegExp(String.raw`(${CREDENTIAL_KEY})"(\s*:\s*)"(?:[^"\\]|\\.)*"`, 'gi'), '$1"$2"[redacted]"'],
  // Quoted values, which may contain spaces: password='p a s s', token: "x"
  [new RegExp(String.raw`(${CREDENTIAL_KEY})(\s*[=:]\s*)"[^"]*"`, 'gi'), '$1$2"[redacted]"'],
  [new RegExp(String.raw`(${CREDENTIAL_KEY})(\s*[=:]\s*)'[^']*'`, 'gi'), "$1$2'[redacted]'"],
  // Header form without quotes: x-api-key: value
  [/\b((?:x-)?api-key|ocp-apim-subscription-key)(\s*:\s*)[^\s,;]+/gi, '$1$2[redacted]'],
];

export function logValue(value: unknown, maxLength = 500): string {
  // Normalize first so a separator or invisible character inside a value
  // cannot split a secret away from its redaction pattern.
  let text = String(value ?? '')
    .replace(INVISIBLE_CHARACTERS, '')
    .replace(LINE_BREAKING_CHARACTERS, ' ');
  for (const [pattern, replacement] of REDACTIONS) {
    text = text.replace(pattern, replacement);
  }
  text = text.trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
