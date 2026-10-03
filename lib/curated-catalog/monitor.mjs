import { canonicalJson, catalogEntries, compareReleaseVersions, sha256, validateCandidate } from './core.mjs';

export function curatedMonitor(apps, payload, discovery, now = new Date()) {
  if (discovery.definitionsSha256 !== sha256(canonicalJson(apps)) || !Array.isArray(discovery.results) ||
      !Number.isFinite(Date.parse(discovery.generatedAt)) || Math.abs(now.getTime() - Date.parse(discovery.generatedAt)) > 24 * 3_600_000) {
    throw new Error('Discovery is stale or does not match the current curated definitions.');
  }
  const alerts = []; const pending = [];
  for (const entry of catalogEntries(apps, payload)) {
    const results = discovery.results.filter(result => result.appId === entry.app.id);
    if (results.length !== 1) { alerts.push(`${entry.app.name}: missing or duplicate source result`); continue; }
    const result = results[0];
    if (result.state === 'error') { alerts.push(`${entry.app.name}: publisher metadata unavailable`); continue; }
    if (result.state === 'manual') { pending.push(`${entry.app.name}: full-installer source review required`); continue; }
    if (result.state !== 'candidate') { alerts.push(`${entry.app.name}: invalid discovery state`); continue; }
    validateCandidate(entry.app, result.candidate, now);
    if (!entry.release || compareReleaseVersions(result.candidate.version, entry.release.candidate.version) > 0) {
      pending.push(`${entry.app.name} ${result.candidate.version}: awaiting isolated verification and approval`);
    } else if (compareReleaseVersions(result.candidate.version, entry.release.candidate.version) === 0 &&
      (result.candidate.installerUrl !== entry.release.candidate.installerUrl ||
       (result.candidate.vendorSha256 && result.candidate.vendorSha256 !== entry.release.installerSha256.toLowerCase()))) {
      alerts.push(`${entry.app.name}: publisher changed an already approved version's installer`);
    }
  }
  if (payload.expiresAt && Date.parse(payload.expiresAt) - now.getTime() <= 2 * 86400_000) alerts.push('Signed catalog expires within two days; maintainer renewal is required');
  return { alerts, pending, approved: catalogEntries(apps, payload).filter(entry => entry.status === 'approved').length };
}
