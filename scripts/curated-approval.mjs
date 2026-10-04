#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJson, sha256, signCatalog, verifyCatalog } from '../lib/curated-catalog/core.mjs';

const mode = process.argv[2];
if (!['prepare', 'sign'].includes(mode)) throw new Error('Choose prepare or sign.');
const { CURATED_APPS, releaseFromVerification, authenticatedCatalogReviewer } = await import(pathToFileURL(resolve('output/curated/runtime/profile-runtime.mjs')).href);
const root = resolve('output/curated/approval');
await mkdir(root, { recursive: true });
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (name, value) => writeFile(resolve(root, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const api = path => {
  const result = spawnSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 2_097_152 });
  if (result.status !== 0) throw new Error('A required authenticated GitHub metadata lookup failed.');
  return JSON.parse(result.stdout);
};
const operation = process.env.CURATED_OPERATION;
if (!['approve', 'withdraw', 'renew'].includes(operation)) throw new Error('Choose approve, withdraw or renew.');
const catalog = await readJson('catalog/curated/catalog.json');
const keys = await readJson('catalog/curated/trusted-keys.json');
const validationTime = catalog.payload.expiresAt ? new Date(Math.min(Date.now(), Date.parse(catalog.payload.expiresAt) - 1)) : new Date();
const payload = verifyCatalog(catalog, CURATED_APPS, keys, validationTime);
let source;

if (operation === 'approve') {
  const runId = process.env.CURATED_VERIFICATION_RUN_ID;
  if (!/^[1-9][0-9]*$/.test(runId || '')) throw new Error('Choose one successful curated verification run ID.');
  const base = 'repos/ugurkocde/IntuneGet-Workflows';
  const run = api(`${base}/actions/runs/${runId}`);
  if (run.status !== 'completed' || run.conclusion !== 'success' || run.head_branch !== 'main' || run.path.split('@')[0] !== '.github/workflows/curated-catalog-verification.yml') throw new Error('Verification has not passed on protected main.');
  const artifacts = api(`${base}/actions/runs/${runId}/artifacts?per_page=100`).artifacts.filter(item => item.name === 'curated-verification-evidence' && !item.expired);
  if (artifacts.length !== 1) throw new Error('Expected one immutable evidence artifact.');
  const artifact = artifacts[0];
  if (artifact.size_in_bytes > 2_097_152) throw new Error('Verification artifact is too large.');
  const download = spawnSync('gh', ['api', `${base}/actions/artifacts/${artifact.id}/zip`], { maxBuffer: 2_097_152 });
  if (download.status !== 0) throw new Error('Authenticated evidence download failed.');
  const artifactSha256 = createHash('sha256').update(download.stdout).digest('hex');
  if (artifact.digest !== `sha256:${artifactSha256}`) throw new Error('GitHub artifact checksum mismatch.');
  const archivePath = resolve(root, 'source.zip');
  await writeFile(archivePath, download.stdout, { flag: 'wx' });
  // Read one fixed JSON entry without extracting arbitrary artifact paths.
  const extracted = spawnSync('unzip', ['-p', archivePath, 'curated-verification.json'], { encoding: 'utf8', maxBuffer: 262_144 });
  if (extracted.status !== 0) throw new Error('The bounded verification JSON entry is unavailable.');
  const report = JSON.parse(extracted.stdout);
  if (!/^[a-f0-9]{40}$/.test(report.provenance.websiteCommit) || !/^[a-f0-9]{40}$/.test(run.head_sha)) throw new Error('Invalid verification commit.');
  for (const [repository, commit] of [['ugurkocde/IntuneGet', report.provenance.websiteCommit], ['ugurkocde/IntuneGet-Workflows', run.head_sha]]) {
    const comparison = api(`repos/${repository}/compare/${commit}...main`);
    if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('Verification source is outside protected main history.');
  }
  source = { report, run, artifact, artifactSha256 };
  // Preparation validates the evidence but emits no release or signature.
  releaseFromVerification(report, run, artifact, {
    websiteCommit: report.provenance.websiteCommit, artifactSha256,
    approvedBy: 'pending-required-maintainer-review', approvedAt: new Date().toISOString(),
    unsignedException: process.env.CURATED_UNSIGNED_EXCEPTION, upgradeException: process.env.CURATED_UPGRADE_EXCEPTION,
  });
}
if (operation === 'withdraw' && !payload.releases.some(release => release.id === process.env.CURATED_RELEASE_ID)) throw new Error('Choose an existing release ID to withdraw.');
if (mode === 'prepare') {
  await writeJson('review.json', { operation, runId: source?.run.id || null, candidate: source?.report.candidate || null,
    installerSha256: source?.report.inspection.current.installerSha256 || null, executionProfileSha256: source?.report.qa.executionProfileSha256 || null,
    signature: source?.report.inspection.current.signature || null, security: source?.report.inspection.current.security || null,
    qa: source?.report.qa || null, releaseId: process.env.CURATED_RELEASE_ID || null,
    unsignedException: process.env.CURATED_UNSIGNED_EXCEPTION || null, upgradeException: process.env.CURATED_UPGRADE_EXCEPTION || null, reviewNote: process.env.CURATED_REVIEW_NOTE || null,
    currentCatalogExpiresAt: payload.expiresAt });
  console.log('Evidence validated. A required maintainer must review the artifact before signing.');
  process.exit(0);
}
if (process.env.GITHUB_REPOSITORY !== 'ugurkocde/IntuneGet' || process.env.GITHUB_REF !== 'refs/heads/main' || !/^[1-9][0-9]*$/.test(process.env.GITHUB_RUN_ID || '')) throw new Error('Signing is restricted to the protected website workflow.');
const reviewer = authenticatedCatalogReviewer(api(`repos/ugurkocde/IntuneGet/actions/runs/${process.env.GITHUB_RUN_ID}/approvals`), api('repos/ugurkocde/IntuneGet/environments/curated-catalog-approval'));
if (!process.env.CURATED_REVIEW_NOTE || process.env.CURATED_REVIEW_NOTE.trim().length < 20) throw new Error('Record the maintainer review of source provenance, licensing, installer arguments and renewal/withdrawal rationale.');
const releases = [...payload.releases]; const withdrawnReleaseIds = [...payload.withdrawnReleaseIds];
if (operation === 'approve') {
  const release = releaseFromVerification(source.report, source.run, source.artifact, { websiteCommit: source.report.provenance.websiteCommit,
    artifactSha256: source.artifactSha256, approvedBy: reviewer, approvedAt: new Date().toISOString(), unsignedException: process.env.CURATED_UNSIGNED_EXCEPTION,
    upgradeException: process.env.CURATED_UPGRADE_EXCEPTION });
  releases.push(release);
  await writeJson('evidence.json', { ...source.report, authenticatedArtifact: { id: source.artifact.id, sha256: source.artifactSha256 }, maintainerReview: { reviewer, note: process.env.CURATED_REVIEW_NOTE, upgradeException: release.evidence.qa.upgrade?.reason ?? null } });
}
if (operation === 'withdraw' && !withdrawnReleaseIds.includes(process.env.CURATED_RELEASE_ID)) withdrawnReleaseIds.push(process.env.CURATED_RELEASE_ID);
const key = process.env.CURATED_CATALOG_SIGNING_KEY;
if (!key) throw new Error('The protected environment signing key is unavailable.');
const keyIds = Object.keys(keys);
if (!keyIds.length) throw new Error('No committed public trust key is installed.');
const now = new Date();
const envelope = signCatalog({ schemaVersion: 1, generatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 7 * 86400_000).toISOString(),
  definitionsSha256: sha256(canonicalJson(CURATED_APPS)), releases, withdrawnReleaseIds }, CURATED_APPS, keyIds.at(-1), key);
verifyCatalog(envelope, CURATED_APPS, keys);
await writeJson('signed-catalog.json', envelope);
console.log(`Created a ${operation} artifact approved by the authenticated required maintainer. Publish it through a reviewed website PR.`);
