/**
 * Prepare a request or upstream derived value for a single server log line.
 *
 * Hosted logs are retained, so credentials are redacted before anything is
 * written: URLs (installer and Intune upload URLs can carry signed tokens),
 * Authorization schemes, JWTs, GitHub tokens, API key headers and credential
 * parameters in query, connection string, quoted, JSON and URL encoded form.
 * Control, line separator and bidirectional formatting characters are
 * replaced so a value cannot forge or visually reorder log lines, and the
 * result is length bounded.
 */

// Key names whose value is a credential, matched as a suffix so that
// client_secret, access_token, api_key and x-api-key are covered too.
const CREDENTIAL_KEY = String.raw`[\w-]*(?:sig|token|secret|key|password|passwd|pwd)`;

const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g;

const REDACTIONS: Array<[RegExp, string]> = [
  [/https?:\/\/\S+/gi, '[redacted URL]'],
  [/\b(Bearer|Basic)\s+[\w.~+/-]+=*/gi, '$1 [redacted]'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted JWT]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '[redacted GitHub token]'],
  [/\bgithub_pat_\w+/g, '[redacted GitHub token]'],
  // JSON shaped: "client_secret": "value"
  [new RegExp(String.raw`"(${CREDENTIAL_KEY})"(\s*:\s*)"(?:[^"\\]|\\.)*"`, 'gi'), '"$1"$2"[redacted]"'],
  // Quoted values, which may contain spaces: password='p a s s', token: "x"
  [new RegExp(String.raw`\b(${CREDENTIAL_KEY})(\s*[=:]\s*)"[^"]*"`, 'gi'), '$1$2"[redacted]"'],
  [new RegExp(String.raw`\b(${CREDENTIAL_KEY})(\s*[=:]\s*)'[^']*'`, 'gi'), "$1$2'[redacted]'"],
  // Header form without quotes: x-api-key: value
  [/\b((?:x-)?api-key|ocp-apim-subscription-key)(\s*:\s*)[^\s,;]+/gi, '$1$2[redacted]'],
  // Query and connection string form: sig=value, Pwd=value;
  [new RegExp(String.raw`\b(${CREDENTIAL_KEY})=[^\s&)"',;]+`, 'gi'), '$1=[redacted]'],
  // URL encoded form: sig%3Dvalue
  [new RegExp(String.raw`\b(${CREDENTIAL_KEY})%3D[^\s&%]+`, 'gi'), '$1%3D[redacted]'],
];

export function logValue(value: unknown, maxLength = 500): string {
  // Normalize first so a separator inside a value cannot split a secret away
  // from its redaction pattern.
  let text = String(value ?? '').replace(UNSAFE_CHARACTERS, ' ');
  for (const [pattern, replacement] of REDACTIONS) {
    text = text.replace(pattern, replacement);
  }
  text = text.trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
