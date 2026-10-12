/**
 * The live QA dashboard exposes short-lived screenshots from a real test VM.
 * Keep it disabled for self-hosted installations unless the operator makes a
 * deliberate decision to publish that telemetry.
 */
const CANONICAL_PUBLIC_HOSTS = new Set(['intuneget.com', 'www.intuneget.com']);

export function isQaLivePublicEnabled(host?: string | null): boolean {
  const configured = process.env.QA_LIVE_PUBLIC_ENABLED;
  if (configured === 'true') return true;
  if (configured === 'false') return false;

  // Keep the first-party dashboard live without requiring a deployment-time
  // flag. Docker explicitly supplies false, and non-canonical self-hosts stay
  // disabled unless their operator opts in.
  const hostname = host?.split(':', 1)[0]?.toLowerCase();
  return Boolean(hostname && CANONICAL_PUBLIC_HOSTS.has(hostname));
}
