/**
 * Prepare a request or upstream derived value for a single server log line.
 *
 * URLs, Bearer tokens and credential parameters are redacted (installer and
 * Intune upload URLs can carry signed tokens), control characters are replaced
 * so a value cannot forge extra log lines, and the result is length bounded.
 */
export function logValue(value: unknown, maxLength = 500): string {
  const text = String(value ?? '')
    .replace(/https?:\/\/\S+/gi, '[redacted URL]')
    .replace(/\bBearer\s+[\w.~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/(sig|token|secret|key|password)=(["']?)[^\s&)"',;]+\2/gi, '$1=$2[redacted]$2')
    .replace(/(sig|token|secret|key|password)(\s*:\s*)(["'])[^"']*\3/gi, '$1$2$3[redacted]$3')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
