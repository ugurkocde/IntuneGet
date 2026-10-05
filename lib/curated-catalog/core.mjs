import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

const SHA256 = /^[a-fA-F0-9]{64}$/;
const VERSION = /^\d+(?:\.\d+){1,3}$/;
const ATTESTATION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ATTESTATION_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_EVIDENCE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_CATALOG_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Production packagers follow any redirect and enforce the pinned installer
// hash. This opt-in lets the isolated verifier do the same for publishers that
// hand downloads to third-party mirrors, but only with a publisher SHA256 pin.
export const MIRROR_REDIRECT_POLICY = 'any-https-mirror-with-pinned-sha256';
const CHECKSUM_FORMATS = ['sha256sums', 'winscp-readme'];
const PHASES = ['install', 'detectionAfterInstall', 'uninstall', 'detectionAfterUninstall'];
const UPGRADE_PHASES = ['upgrade', 'detectionAfterUpgrade'];
const SIGNATURE_STATUSES = ['valid', 'unsigned', 'untrusted'];

export class CuratedCatalogError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CuratedCatalogError';
    this.code = 'CURATED_RELEASE_UNAVAILABLE';
  }
}

function requireValue(condition, message) {
  if (!condition) throw new CuratedCatalogError(message);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  requireValue(value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)), 'Only finite JSON values can be signed.');
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function isCuratedPackageId(value) {
  return typeof value === 'string' && value.toLowerCase().startsWith('intuneget.curated.');
}

export function assertHttpsUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new CuratedCatalogError('A valid HTTPS URL is required.'); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.hash && (!url.port || url.port === '443'), 'A credential-free HTTPS URL is required.');
  return url;
}

export function assertInstallerSource(app, value) {
  const url = assertHttpsUrl(value);
  requireValue(!/%(?:2f|5c|2e)/i.test(url.pathname) && !url.pathname.includes('\\'), 'Encoded installer paths are not supported.');
  requireValue(app.allowedInstallerSources.some(source => url.origin === source.origin && url.pathname.startsWith(source.pathPrefix)), `Installer source is not approved for ${app.name}.`);
  requireValue(/\.(?:msi|exe)$/i.test(url.pathname), 'The pilot requires a direct MSI or EXE installer URL.');
  return url;
}

export function validateDefinitions(apps) {
  requireValue(Array.isArray(apps) && apps.length > 0, 'App definitions are missing.');
  const ids = new Set();
  const packageIds = new Set();
  const attestations = new Map();
  for (const app of apps) {
    requireValue(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app.id), 'Invalid curated app identifier.');
    requireValue(isCuratedPackageId(app.packageId) && /^[A-Za-z0-9.]+$/.test(app.packageId), 'Invalid curated package identifier.');
    requireValue(!ids.has(app.id) && !packageIds.has(app.packageId.toLowerCase()), 'Duplicate curated app identifier.');
    ids.add(app.id); packageIds.add(app.packageId.toLowerCase());
    requireValue(['x64', 'x86'].includes(app.architecture) && app.scope === 'machine', 'The pilot supports x64 or x86 machine deployments only.');
    requireValue(['msi', 'exe', 'inno', 'nullsoft'].includes(app.installerType) && typeof app.silentArgs === 'string' && app.silentArgs.trim(), 'A reviewed unattended installer contract is required.');
    requireValue(Array.isArray(app.signaturePublishers) && typeof app.allowUnsigned === 'boolean' && (app.allowUnsigned || app.signaturePublishers.length > 0), 'A publisher signature policy is required.');
    // Automated approval accepts an unsigned installer only under a reason
    // reviewed in the definition itself, never one supplied at approval time.
    requireValue(app.allowUnsigned ? typeof app.unsignedExceptionReason === 'string' && app.unsignedExceptionReason.trim().length >= 20 : app.unsignedExceptionReason === undefined, 'An unsigned installer policy requires a reviewed exception reason in the definition.');
    requireValue(typeof app.installedIdentity?.displayNamePattern === 'string' && app.installedIdentity.displayNamePattern.startsWith('^') && app.installedIdentity.displayNamePattern.endsWith('$') && app.installedIdentity.displayNamePattern.length <= 200, 'An anchored installed application identity is required.');
    new RegExp(app.installedIdentity.displayNamePattern);
    requireValue(Array.isArray(app.installedIdentity.executablePaths) && app.installedIdentity.executablePaths.length > 0 && app.installedIdentity.executablePaths.every(path => typeof path === 'string' && !path.startsWith('/') && !path.startsWith('\\') && !path.includes(':') && !path.split(/[\\/]/).some(part => part === '..' || !part) && /\.exe$/i.test(path)), 'Installed executables must have safe paths relative to Program Files.');
    assertHttpsUrl(app.homepage); assertHttpsUrl(app.releaseSource);
    requireValue(Array.isArray(app.allowedInstallerSources) && app.allowedInstallerSources.length > 0, 'Installer sources are missing.');
    for (const source of app.allowedInstallerSources) {
      requireValue(assertHttpsUrl(source.origin).origin === source.origin && source.pathPrefix.startsWith('/') && source.pathPrefix.endsWith('/'), 'Installer sources must use an exact origin and directory prefix.');
    }
    requireValue(['vendor-managed', 'none'].includes(app.autoUpdate), 'A reviewed vendor auto-update policy is required.');
    if (app.registeredUninstall !== undefined) {
      const { displayName, key } = app.registeredUninstall || {};
      requireValue(Object.keys(app.registeredUninstall || {}).sort().join() === 'displayName,key' && typeof displayName === 'string' && displayName.trim() === displayName && displayName.length > 0 && displayName.length <= 200 &&
        typeof key === 'string' && (/^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/.test(key) || /^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}_[A-Za-z0-9._+-]{1,32}$/.test(key) || /^[A-Za-z0-9][A-Za-z0-9 ._{}()+-]{0,255}$/.test(key)) &&
        new RegExp(app.installedIdentity.displayNamePattern).test(displayName), 'A registered uninstall identity needs an exact key and a display name.');
    }
    requireValue(['github', 'chrome', 'firefox', 'vscode', 'vlc', 'winscp', 'putty', 'adobe', 'manual'].includes(app.discovery), 'Unknown discovery method.');
    if (app.discovery === 'github') new RegExp(app.assetPattern);
    requireValue(app.installerRedirectPolicy === undefined || app.installerRedirectPolicy === MIRROR_REDIRECT_POLICY, 'Unknown installer redirect policy.');
    requireValue(app.installerRedirectPolicy === undefined || app.checksumSource, 'Mirror redirects require a publisher checksum source.');
    if (app.checksumSource !== undefined) validateChecksumSource(app);
    if (app.licenceAttestation !== undefined) {
      const attestation = app.licenceAttestation;
      requireValue(attestation !== null && typeof attestation === 'object' && Object.keys(attestation).sort().join() === 'id,title,url,version', 'A licence attestation requires exactly an id, title, url, and version.');
      requireValue(typeof attestation.id === 'string' && ATTESTATION_ID.test(attestation.id) && attestation.id.length <= 64, 'Invalid licence attestation identifier.');
      requireValue(typeof attestation.title === 'string' && attestation.title.trim().length >= 3 && attestation.title.length <= 200, 'A licence attestation title is required.');
      requireValue(typeof attestation.version === 'string' && ATTESTATION_VERSION.test(attestation.version), 'Invalid licence attestation version.');
      let agreementUrl = null;
      try { agreementUrl = assertHttpsUrl(attestation.url); } catch { agreementUrl = null; }
      requireValue(agreementUrl, 'A licence attestation requires a credential-free HTTPS URL.');
      const previous = attestations.get(attestation.id);
      requireValue(!previous || canonicalJson(previous) === canonicalJson(attestation), 'Apps sharing a licence attestation must declare the same agreement.');
      attestations.set(attestation.id, attestation);
    }
  }
  return apps;
}

export function checksumSourceUrl(app, version) {
  requireValue(VERSION.test(version), 'An exact numeric release version is required.');
  return assertHttpsUrl(app.checksumSource.urlTemplate.replaceAll('{version}', version)).href;
}

function validateChecksumSource(app) {
  const source = app.checksumSource;
  requireValue(source && typeof source.urlTemplate === 'string' && typeof source.entryTemplate === 'string' && CHECKSUM_FORMATS.includes(source.format) &&
    Object.keys(source).length === 3 && source.urlTemplate.includes('{version}') && source.entryTemplate.includes('{version}'), 'A checksum source needs a URL template, entry template, and known format.');
  const url = new URL(checksumSourceUrl(app, '1.0.0'));
  // Checksums must come from the publisher host that serves release metadata
  // or installers, as small text files, never from an installer path.
  // Installer hosts are only trusted within their reviewed path prefix.
  const onVendorHost = url.origin === new URL(app.releaseSource).origin ||
    app.allowedInstallerSources.some(source => url.origin === source.origin && url.pathname.startsWith(source.pathPrefix));
  requireValue(onVendorHost && !url.search && !/%(?:2f|5c|2e)/i.test(url.pathname) && !url.pathname.includes('\\') && !/\.(?:msi|exe|msix|appx|zip|7z)$/i.test(url.pathname), 'Checksum sources must be text files on a publisher host.');
  const entry = source.entryTemplate.replaceAll('{version}', '1.0.0');
  requireValue(!entry.startsWith('/') && !entry.split('/').some(part => part === '..' || !part) && !/[\\\r\n]/.test(entry) && /\.(?:msi|exe)$/i.test(entry), 'Checksum entries must be safe relative installer names.');
}

function candidateIdentity(candidate) {
  return sha256(canonicalJson({ appId: candidate.appId, version: candidate.version, installerUrl: candidate.installerUrl, vendorSha256: candidate.vendorSha256 })).slice(0, 24);
}

export function createCandidate(app, { version, installerUrl, vendorSha256 = null, releaseNotesUrl = app.homepage }, now = new Date()) {
  const candidate = {
    appId: app.id, version, installerUrl,
    vendorSha256: vendorSha256 ? vendorSha256.toLowerCase() : null,
    releaseNotesUrl, discoveredAt: now.toISOString(),
  };
  candidate.id = candidateIdentity(candidate);
  validateCandidate(app, candidate, now);
  return candidate;
}

function timestamp(value) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value)), 'A valid UTC evidence timestamp is required.');
  return Date.parse(value);
}

export function validateCandidate(app, candidate, now = new Date()) {
  requireValue(candidate?.appId === app.id && candidate.id === candidateIdentity(candidate), 'The candidate identity does not match its source metadata.');
  requireValue(typeof candidate.version === 'string' && VERSION.test(candidate.version), 'An exact numeric release version is required.');
  assertInstallerSource(app, candidate.installerUrl);
  requireValue(candidate.vendorSha256 === null || SHA256.test(candidate.vendorSha256), 'Invalid vendor SHA256.');
  requireValue(app.installerRedirectPolicy !== MIRROR_REDIRECT_POLICY || candidate.vendorSha256 !== null, `${app.name} follows download mirrors and requires a publisher SHA256 pin.`);
  assertHttpsUrl(candidate.releaseNotesUrl);
  requireValue(timestamp(candidate.discoveredAt) <= now.getTime(), 'Discovery time cannot be in the future.');
  return candidate;
}

export function validateRelease(app, release, now = new Date()) {
  validateCandidate(app, release.candidate, now);
  requireValue(release.id === `${app.id}:${release.candidate.id}`, 'Invalid curated release identifier.');
  requireValue(SHA256.test(release.installerSha256) && SHA256.test(release.executionProfileSha256), 'The installer and execution profile hashes are required.');
  const evidence = release.evidence;
  requireValue(evidence && evidence.installerSha256?.toLowerCase() === release.installerSha256.toLowerCase(), 'Verifier evidence belongs to a different installer.');
  const provenance = evidence.provenance;
  requireValue(provenance?.repository === 'ugurkocde/IntuneGet-Workflows' && provenance.workflowPath === '.github/workflows/curated-catalog-verification.yml' && /^[a-f0-9]{40}$/.test(provenance.workflowCommit) && /^[a-f0-9]{40}$/.test(provenance.websiteCommit) && /^[1-9][0-9]*$/.test(provenance.runId) && Number.isSafeInteger(provenance.runAttempt) && provenance.runAttempt > 0 && /^[1-9][0-9]*$/.test(provenance.artifactId) && SHA256.test(provenance.artifactSha256), 'Authenticated verification run and artifact provenance are required.');
  requireValue(!release.candidate.vendorSha256 || release.candidate.vendorSha256.toLowerCase() === release.installerSha256.toLowerCase(), 'Vendor checksum does not match the verified installer.');
  requireValue(VERSION.test(evidence.installerVersion) && compareReleaseVersions(evidence.installerVersion, release.candidate.version) === 0 && evidence.architecture === app.architecture, 'Installer version or architecture does not match the candidate.');
  for (const person of [release.preparedBy, release.approvedBy, evidence.sourceReviewedBy]) requireValue(typeof person === 'string' && person.trim().length >= 3, 'Named preparation, source review, and approval are required.');
  requireValue(release.preparedBy.trim().toLowerCase() !== release.approvedBy.trim().toLowerCase(), 'Preparation and approval must be performed by different reviewers.');
  assertHttpsUrl(evidence.sourceReportUrl);
  // Trust rests on the publisher-pinned and measured SHA256, not on the
  // Authenticode signer, whose names change between certificates. The
  // observed signature is recorded for transparency only.
  const signature = evidence.signature;
  requireValue(signature && SIGNATURE_STATUSES.includes(signature.status) && (signature.publisher === null || (typeof signature.publisher === 'string' && signature.publisher.length <= 200)), 'Observed signature evidence is required.');
  const security = evidence.security;
  requireValue(security && ['virustotal', 'defender'].includes(security.scanner) && security.status === 'clean' && security.malicious === 0 && security.suspicious === 0, 'Clean malware evidence is required before approval.');
  requireValue(security.installerSha256?.toLowerCase() === release.installerSha256.toLowerCase(), 'Malware evidence belongs to a different installer.');
  assertHttpsUrl(security.reportUrl);
  const qa = evidence.qa;
  requireValue(qa?.testLevel === 'psadt-package' && qa.executionContext === 'LocalSystem', 'The actual machine PSADT package must be tested.');
  requireValue(qa.installerSha256?.toLowerCase() === release.installerSha256.toLowerCase() && qa.executionProfileSha256?.toLowerCase() === release.executionProfileSha256.toLowerCase(), 'QA evidence belongs to a different installer or execution profile.');
  requireValue(/^[a-f0-9]{40}$/i.test(qa.packagerCommit), 'The QA toolchain commit must be recorded.');
  if (qa.upgrade === undefined) {
    requireValue(VERSION.test(qa.upgradeFromVersion) && compareReleaseVersions(qa.upgradeFromVersion, release.candidate.version) < 0, 'A tested upgrade from an earlier version is required.');
    requireValue([...PHASES, ...UPGRADE_PHASES].every(phase => qa.phases?.[phase]?.passed === true), 'Install, detection, upgrade, uninstall, and removal checks must all pass.');
  } else {
    // Only apps whose own updater handles upgrades may qualify without an
    // upgrade test, and the skip must carry the maintainer's written reason.
    const upgrade = qa.upgrade;
    requireValue(app.autoUpdate === 'vendor-managed', 'Only vendor-managed apps may qualify without a tested upgrade.');
    requireValue(upgrade !== null && typeof upgrade === 'object' && Object.keys(upgrade).sort().join() === 'reason,tested' && upgrade.tested === false &&
      typeof upgrade.reason === 'string' && upgrade.reason.trim().length >= 20, 'A skipped upgrade test requires an explicit reviewed exemption reason.');
    requireValue(qa.upgradeFromVersion === undefined && qa.previousInstallerSha256 === undefined && UPGRADE_PHASES.every(phase => qa.phases?.[phase] === undefined), 'A skipped upgrade test cannot carry upgrade evidence.');
    requireValue(PHASES.every(phase => qa.phases?.[phase]?.passed === true), 'Install, detection, uninstall, and removal checks must all pass.');
  }
  assertHttpsUrl(qa.reportUrl);
  const approvedAt = timestamp(release.approvedAt);
  requireValue(approvedAt <= now.getTime() && approvedAt >= timestamp(release.candidate.discoveredAt), 'Invalid release approval time.');
  for (const value of [evidence.verifiedAt, security.scannedAt, qa.testedAt]) {
    const at = timestamp(value);
    requireValue(at <= approvedAt && at >= timestamp(release.candidate.discoveredAt) && approvedAt - at <= MAX_EVIDENCE_AGE_MS, 'Approval requires recent evidence collected after discovery.');
  }
  return release;
}

export function compareReleaseVersions(left, right) {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const delta = (a[i] || 0) - (b[i] || 0);
    if (delta) return Math.sign(delta);
  }
  return 0;
}

export function verifyCatalog(envelope, apps, trustedKeys, now = new Date()) {
  validateDefinitions(apps);
  const payload = envelope?.payload;
  requireValue(payload?.schemaVersion === 1 && Array.isArray(payload.releases) && Array.isArray(payload.withdrawnReleaseIds), 'Invalid curated catalog schema.');
  // The committed bootstrap has no release authority and needs no key setup.
  if (payload.releases.length === 0 && payload.withdrawnReleaseIds.length === 0 && envelope.signature === null && envelope.keyId === null && payload.generatedAt === null && payload.expiresAt === null && payload.definitionsSha256 === null) return payload;
  requireValue(typeof envelope.keyId === 'string' && Object.hasOwn(trustedKeys, envelope.keyId), 'The curated catalog signing key is not trusted.');
  const key = createPublicKey(trustedKeys[envelope.keyId]);
  requireValue(key.asymmetricKeyType === 'ed25519', 'Curated catalogs require an Ed25519 signing key.');
  requireValue(typeof envelope.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature) && verify(null, Buffer.from(canonicalJson(payload)), key, Buffer.from(envelope.signature, 'base64')), 'The curated catalog signature is invalid.');
  const generatedAt = timestamp(payload.generatedAt); const expiresAt = timestamp(payload.expiresAt);
  requireValue(generatedAt <= now.getTime() && expiresAt > now.getTime() && expiresAt > generatedAt && expiresAt - generatedAt <= MAX_CATALOG_AGE_MS, 'The signed curated catalog has expired or has invalid validity dates.');
  requireValue(payload.definitionsSha256 === sha256(canonicalJson(apps)), 'The signed catalog does not match the reviewed app definitions.');
  const releases = new Set();
  for (const release of payload.releases) {
    const app = apps.find(app => app.id === release.candidate?.appId);
    requireValue(app && !releases.has(release.id), 'Unknown or duplicate curated release.');
    requireValue(!payload.releases.some(previous => previous !== release && previous.candidate?.appId === app.id && VERSION.test(previous.candidate.version) && VERSION.test(release.candidate.version) && compareReleaseVersions(previous.candidate.version, release.candidate.version) === 0), 'A curated version can have only one immutable release record.');
    validateRelease(app, release, now);
    requireValue(timestamp(release.approvedAt) <= generatedAt, 'The catalog predates release approval.');
    releases.add(release.id);
  }
  requireValue(new Set(payload.withdrawnReleaseIds).size === payload.withdrawnReleaseIds.length && payload.withdrawnReleaseIds.every(id => releases.has(id)), 'Invalid release withdrawal list.');
  return payload;
}

/**
 * Authenticates only the signer, for automated re-signing. Expiry and the
 * definitions digest are not checked here, so every carried-over release must
 * be revalidated against the current definitions before it is signed again.
 */
export function verifyCatalogSignature(envelope, trustedKeys) {
  const payload = envelope?.payload;
  requireValue(payload?.schemaVersion === 1 && Array.isArray(payload.releases) && Array.isArray(payload.withdrawnReleaseIds), 'Invalid curated catalog schema.');
  if (envelope.signature === null && envelope.keyId === null && payload.releases.length === 0 && payload.withdrawnReleaseIds.length === 0) return payload;
  requireValue(typeof envelope.keyId === 'string' && Object.hasOwn(trustedKeys, envelope.keyId), 'The curated catalog signing key is not trusted.');
  const key = createPublicKey(trustedKeys[envelope.keyId]);
  requireValue(key.asymmetricKeyType === 'ed25519' && typeof envelope.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature) &&
    verify(null, Buffer.from(canonicalJson(payload)), key, Buffer.from(envelope.signature, 'base64')), 'The curated catalog signature is invalid.');
  return payload;
}

/**
 * Serving check that tolerates a definitions change the automation has not
 * re-signed yet. The signer and validity window are enforced; each release is
 * then revalidated against the current definitions and dropped individually
 * if it no longer qualifies. `current` reports whether the digest matches.
 */
export function verifyCatalogReleases(envelope, apps, trustedKeys, now = new Date()) {
  validateDefinitions(apps);
  const signed = verifyCatalogSignature(envelope, trustedKeys);
  if (envelope.signature === null) return { payload: signed, current: true };
  const generatedAt = timestamp(signed.generatedAt); const expiresAt = timestamp(signed.expiresAt);
  requireValue(generatedAt <= now.getTime() && expiresAt > now.getTime() && expiresAt > generatedAt && expiresAt - generatedAt <= MAX_CATALOG_AGE_MS, 'The signed curated catalog has expired or has invalid validity dates.');
  const releases = [];
  for (const release of signed.releases) {
    const app = apps.find(app => app.id === release.candidate?.appId);
    if (!app || releases.some(kept => kept.id === release.id || (kept.candidate.appId === app.id && compareReleaseVersions(kept.candidate.version, release.candidate.version) === 0))) continue;
    try { validateRelease(app, release, now); } catch { continue; }
    if (timestamp(release.approvedAt) <= generatedAt) releases.push(release);
  }
  const kept = new Set(releases.map(release => release.id));
  return {
    payload: { ...signed, releases, withdrawnReleaseIds: signed.withdrawnReleaseIds.filter(id => kept.has(id)) },
    current: signed.definitionsSha256 === sha256(canonicalJson(apps)) && releases.length === signed.releases.length,
  };
}

export function signCatalog(payload, apps, keyId, privateKey) {
  const key = createPrivateKey(privateKey);
  requireValue(key.asymmetricKeyType === 'ed25519', 'Curated catalogs require an Ed25519 signing key.');
  const envelope = { payload, keyId, signature: sign(null, Buffer.from(canonicalJson(payload)), key).toString('base64') };
  verifyCatalog(envelope, apps, { [keyId]: createPublicKey(key).export({ type: 'spki', format: 'pem' }) });
  return envelope;
}

export function catalogEntries(apps, payload) {
  const withdrawn = new Set(payload.withdrawnReleaseIds);
  return apps.map(app => {
    const all = payload.releases.filter(release => release.candidate.appId === app.id);
    const release = all.filter(release => !withdrawn.has(release.id)).sort((a, b) => compareReleaseVersions(b.candidate.version, a.candidate.version))[0] || null;
    return { app, status: release ? 'approved' : all.length ? 'withdrawn' : 'pending', release };
  });
}
