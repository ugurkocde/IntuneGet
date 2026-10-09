/**
 * Prepare a request or upstream derived value for a single server log line.
 *
 * URLs and credential parameters are redacted (installer and Intune upload
 * URLs can carry signed tokens), control characters are replaced so a value
 * cannot forge extra log lines, and the result is length bounded.
 */
export function logValue(value: unknown, maxLength = 500): string {
  const text = String(value ?? '')
    .replace(/https?:\/\/\S+/gi, '[redacted URL]')
    .replace(/(sig|token|secret|key|password)=[^\s&)"']+/gi, '$1=[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
