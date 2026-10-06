#!/usr/bin/env node
// Fully automated curated catalog pipeline.
//
// plan:    reads publisher metadata, dispatches isolated VM verification for
//          new releases, selects passing runs whose authenticated evidence
//          satisfies the release policy, and decides whether to re-sign.
// publish: re-authenticates the selected evidence, signs the catalog with the
//          environment key and opens an auto-merging website PR.
//
// Neither mode downloads, extracts or runs an installer on this machine. The
// isolated QA VM does that; this script only handles bounded JSON evidence.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogEntries, compareReleaseVersions, sha256, canonicalJson, signCatalog, validateRelease, verifyCatalog, verifyCatalogSignature } from '../lib/curated-catalog/core.mjs';
import { discoverCandidate, discoverPreviousCandidate } from '../lib/curated-catalog/discovery.mjs';
import { curatedMonitor } from '../lib/curated-catalog/monitor.mjs';
import { createCuratedGitHubClient } from './curated-github.mjs';
import { enqueueCuratedVerification, processConfigVerifications, supabaseConfigured, syncHistory } from './curated-qa-store.mjs';

const WEBSITE = 'ugurkocde/IntuneGet';
const QA = 'ugurkocde/IntuneGet-Workflows';
const VERIFY_WORKFLOW = 'curated-catalog-verification.yml';
const BRANCH = 'automation/curated-catalog';
const ISSUE_TITLE = 'Curated catalog automation needs attention';
// Failures are counted since the curated verifier code last changed, so a
// merged fix retries. The QA repository's main moves with every ordinary QA
// result, so its head commit cannot be used for this.
const MAX_FAILURES_PER_VERIFIER = 2;
// Backstop regardless of verifier changes, protecting the shared QA VM. It
// leaves room for retries after a fix that lands on a day of failures.
const MAX_FAILURES_PER_DAY = 8;
const VERIFIER_PATHS = [[QA, 'qa/curated'], [QA, '.github/workflows/curated-catalog-verification.yml'], [WEBSITE, 'lib/curated-catalog'], [WEBSITE, 'lib/packaging-adapters.ts']];
const RETRY_COOLDOWN_MS = 2 * 3_600_000;
const RENEW_BEFORE_MS = 3 * 86_400_000;
const STALE_PR_MS = 3 * 3_600_000;
const CATALOG_PATH = 'catalog/curated/catalog.json';
const KEYS_PATH = 'catalog/curated/trusted-keys.json';
const root = resolve('output/curated/automation');

const mode = process.argv[2];
if (!['plan', 'publish'].includes(mode)) throw new Error('Choose plan or publish.');
const { CURATED_APPS, releaseFromVerification, automatedApprovalExceptions, assertCuratedPackageProfile, AUTOMATED_APPROVER, buildCuratedCartItem } =
  await import(pathToFileURL(resolve('output/curated/runtime/profile-runtime.mjs')).href);
await mkdir(root, { recursive: true });

// The private QA repository needs its own credential; GH_TOKEN covers the
// website repository (catalog branch, PR and auto-merge).
function tokenFor(args) {
  return args.some(arg => arg.startsWith(`repos/${QA}/`)) && process.env.CURATED_QA_TOKEN ? process.env.CURATED_QA_TOKEN : process.env.GH_TOKEN;
}

const gh = createCuratedGitHubClient({ tokenFor });

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const appById = id => CURATED_APPS.find(app => app.id === id);
const releaseIdFor = candidate => `${candidate.appId}:${candidate.id}`;
const trustedKeys = async () => ({ ...(await readJson(KEYS_PATH)), ...JSON.parse(process.env.CURATED_CATALOG_PUBLIC_KEYS || '{}') });

/** Downloads one bounded evidence JSON entry and checks GitHub's artifact digest. */
async function runEvidence(runId) {
  const artifacts = (await gh(['api', `repos/${QA}/actions/runs/${runId}/artifacts?per_page=100`])).artifacts
    .filter(item => item.name === 'curated-verification-evidence' && !item.expired);
  if (artifacts.length !== 1) throw new Error('Expected one immutable evidence artifact.');
  const artifact = artifacts[0];
  if (artifact.size_in_bytes > 2_097_152) throw new Error('Verification artifact is too large.');
  const zip = await gh(['api', `repos/${QA}/actions/artifacts/${artifact.id}/zip`], { raw: true });
  const artifactSha256 = createHash('sha256').update(zip).digest('hex');
  if (artifact.digest !== `sha256:${artifactSha256}`) throw new Error('GitHub artifact checksum mismatch.');
  const archive = resolve(root, `${randomUUID()}.zip`);
  return writeFile(archive, zip, { flag: 'wx' }).then(async () => {
    // Read one fixed JSON entry without extracting arbitrary artifact paths.
    const extracted = spawnSync('unzip', ['-p', archive, 'curated-verification.json'], { encoding: 'utf8', maxBuffer: 262_144 });
    await rm(archive, { force: true });
    if (extracted.status !== 0) throw new Error('The bounded verification JSON entry is unavailable.');
    return { artifact, artifactSha256, report: JSON.parse(extracted.stdout) };
  });
}

/** Builds a release only from a passing protected run on main with authenticated evidence. */
async function approvedRelease(runId, approvedAt) {
  if (!/^[1-9][0-9]*$/.test(String(runId))) throw new Error('Invalid verification run ID.');
  const run = await gh(['api', `repos/${QA}/actions/runs/${runId}`]);
  if (run.status !== 'completed' || run.conclusion !== 'success' || run.head_branch !== 'main' || run.path.split('@')[0] !== `.github/workflows/${VERIFY_WORKFLOW}`) {
    throw new Error('Verification has not passed on protected main.');
  }
  const { artifact, artifactSha256, report } = await runEvidence(runId);
  if (!/^[a-f0-9]{40}$/.test(report.provenance?.websiteCommit || '') || !/^[a-f0-9]{40}$/.test(run.head_sha)) throw new Error('Invalid verification commit.');
  for (const [repository, commit] of [[WEBSITE, report.provenance.websiteCommit], [QA, run.head_sha]]) {
    const comparison = await gh(['api', `repos/${repository}/compare/${commit}...main`]);
    if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('Verification source is outside protected main history.');
  }
  const app = appById(report.candidate?.appId);
  if (!app) throw new Error('Unknown verification app.');
  const exceptions = automatedApprovalExceptions(app, report);
  const release = releaseFromVerification(report, run, artifact, {
    websiteCommit: report.provenance.websiteCommit, artifactSha256, approvedBy: AUTOMATED_APPROVER, approvedAt, ...exceptions,
  });
  assertCuratedPackageProfile(app, release);
  const evidence = { ...report, authenticatedArtifact: { id: artifact.id, sha256: artifactSha256 },
    automatedApproval: { approvedBy: AUTOMATED_APPROVER, approvedAt, unsignedException: exceptions.unsignedException ?? null, upgradeException: exceptions.upgradeException ?? null } };
  return { app, release, evidence };
}

async function dispatchVerification(inputs) {
  const body = { ref: 'main', inputs };
  if (process.env.CURATED_DRY_RUN === 'true') console.log(`Dry run: would dispatch ${JSON.stringify(body)}`);
  else return enqueueCuratedVerification(inputs);
}

/** A passing run must come from protected main of both repositories. */
async function authenticateRun(run, report) {
  const current = await gh(['api', `repos/${QA}/actions/runs/${run.id}`]);
  if (current.status !== 'completed' || current.conclusion !== 'success' || current.head_branch !== 'main' || current.path.split('@')[0] !== `.github/workflows/${VERIFY_WORKFLOW}`) {
    throw new Error('Verification has not passed on protected main.');
  }
  if (report.provenance?.runId !== String(run.id) || report.provenance?.workflowCommit !== current.head_sha) throw new Error('Verification report provenance is invalid.');
  for (const [repository, commit] of [[WEBSITE, report.provenance.websiteCommit], [QA, current.head_sha]]) {
    if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Invalid verification commit.');
    const comparison = await gh(['api', `repos/${repository}/compare/${commit}...main`]);
    if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('Verification source is outside protected main history.');
  }
}

/**
 * Carries forward every signed release that still satisfies the current
 * definitions and packaging profile. Releases that no longer do are dropped
 * so the app is verified again, instead of making the whole catalog invalid.
 */
async function loadCatalog(envelope, now) {
  const keys = await trustedKeys();
  const signed = verifyCatalogSignature(envelope, keys);
  let current = false;
  try { verifyCatalog(envelope, CURATED_APPS, keys, now); current = true; } catch { current = false; }
  const releases = []; const dropped = [];
  for (const release of signed.releases) {
    const app = appById(release.candidate?.appId);
    try {
      if (!app) throw new Error('Unknown app');
      validateRelease(app, release, now);
      assertCuratedPackageProfile(app, release);
      releases.push(release);
    } catch { dropped.push(release.id); }
  }
  const kept = new Set(releases.map(release => release.id));
  return {
    current, dropped,
    payload: { ...signed, releases, withdrawnReleaseIds: signed.withdrawnReleaseIds.filter(id => kept.has(id)) },
  };
}

function latestApproved(payload, appId) {
  return catalogEntries(CURATED_APPS, payload).find(entry => entry.app.id === appId)?.release || null;
}

function summaryTable(rows) {
  return ['| App | Publisher release | Approved | State |', '| --- | --- | --- | --- |',
    ...rows.map(row => `| ${row.app} | ${row.discovered} | ${row.approved} | ${row.state} |`)].join('\n');
}

async function appendSummary(markdown) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, { flag: 'a' });
}

async function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, { flag: 'a' });
}

/** One open issue in the private QA repository tracks alerts; it closes when they clear. */
async function syncAlertIssue(alerts, runUrl) {
  const open = (await gh(['api', `repos/${QA}/issues?state=open&per_page=100`]) || []).filter(issue => !issue.pull_request && issue.title === ISSUE_TITLE);
  if (!alerts.length) {
    for (const issue of open) {
      await gh(['api', '-X', 'POST', `repos/${QA}/issues/${issue.number}/comments`, '--input', '-'], { input: JSON.stringify({ body: `Resolved. All alerts cleared in ${runUrl}.` }) });
      await gh(['api', '-X', 'PATCH', `repos/${QA}/issues/${issue.number}`, '--input', '-'], { input: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
    }
    return;
  }
  const body = ['The curated catalog automation found problems it cannot resolve on its own.', '', ...alerts.map(alert => `- ${alert}`), '', `Latest run: ${runUrl}`,
    '', 'This issue updates on every run and closes automatically when the alerts clear.'].join('\n');
  if (open.length) {
    if (open[0].body !== body) await gh(['api', '-X', 'PATCH', `repos/${QA}/issues/${open[0].number}`, '--input', '-'], { input: JSON.stringify({ body }) });
  } else {
    await gh(['api', '-X', 'POST', `repos/${QA}/issues`, '--input', '-'], { input: JSON.stringify({ title: ISSUE_TITLE, body }) });
  }
}

async function plan() {
  const now = new Date();
  const runUrl = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY || WEBSITE}/actions/runs/${process.env.GITHUB_RUN_ID || 'local'}`;
  const alerts = []; const rows = []; const approvals = []; const configStates = [];
  const catalog = await loadCatalog(await readJson(CATALOG_PATH), now);
  const { payload } = catalog;
  if (catalog.dropped.length) alerts.push(`Dropped ${catalog.dropped.length} release(s) that no longer match the current definitions or packaging; they will be verified again.`);

  const discovery = { generatedAt: now.toISOString(), definitionsSha256: sha256(canonicalJson(CURATED_APPS)), results: [] };
  for (const app of CURATED_APPS) {
    try { discovery.results.push(await discoverCandidate(app)); }
    catch (error) { discovery.results.push({ appId: app.id, state: 'error', message: error.message }); }
  }
  // Reuse the monitor for publisher-side anomalies such as a changed installer
  // behind an already approved version. Expiry is handled by renewal below.
  const monitor = curatedMonitor(CURATED_APPS, payload, discovery, new Date());
  for (const alert of monitor.alerts) if (/changed an already approved/.test(alert)) alerts.push(alert);

  const allRuns = ((await gh(['api', `repos/${QA}/actions/workflows/${VERIFY_WORKFLOW}/runs?per_page=100`])).workflow_runs || [])
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const runs = allRuns
    .map(run => ({ ...run, candidateId: /\[([a-f0-9]{24})\]\s*$/.exec(run.display_title || '')?.[1] || null }))
    .filter(run => run.candidateId);
  let verifierChangedAt = 0;
  for (const [repository, path] of VERIFIER_PATHS) {
    const [latest] = await gh(['api', `repos/${repository}/commits?sha=main&path=${encodeURIComponent(path)}&per_page=1`]) || [];
    verifierChangedAt = Math.max(verifierChangedAt, latest ? Date.parse(latest.commit.committer.date) : 0);
  }

  // Discover all requests independently of available VM slots. The minute
  // dispatcher orders this durable queue alongside ordinary customer QA.
  if (supabaseConfigured()) {
    try {
      const configs = await processConfigVerifications({
        runs: allRuns, releases: payload.releases.filter(release => !payload.withdrawnReleaseIds.includes(release.id)), apps: CURATED_APPS,
        readEvidence: runEvidence, authenticate: authenticateRun, dispatch: dispatchVerification,
        slots: 100, now,
      });
      configStates.push(...configs.states);
    } catch (error) { alerts.push(`Custom configuration verification could not be processed: ${error.message}`); }
  }

  for (const app of CURATED_APPS) {
    const result = discovery.results.find(item => item.appId === app.id);
    const latest = latestApproved(payload, app.id);
    const row = { app: app.name, discovered: '', approved: latest?.candidate.version || 'none', state: '' };
    rows.push(row);
    if (result.state !== 'candidate') {
      row.discovered = 'unavailable';
      row.state = `Publisher metadata unavailable: ${result.message || result.state}`;
      continue;
    }
    const candidate = result.candidate;
    row.discovered = candidate.version;
    if (latest && compareReleaseVersions(candidate.version, latest.candidate.version) <= 0) { row.state = 'Up to date'; continue; }
    if (payload.releases.some(release => release.id === releaseIdFor(candidate))) { row.state = 'Withdrawn; waiting for a newer release'; continue; }

    const mine = runs.filter(run => run.candidateId === candidate.id);
    if (mine.some(run => run.status !== 'completed')) { row.state = `Verifying (run ${mine.find(run => run.status !== 'completed').id})`; continue; }
    const failures = [];
    const success = mine.find(run => run.conclusion === 'success' && run.head_branch === 'main');
    if (success) {
      try {
        await approvedRelease(success.id, now.toISOString());
        approvals.push(success.id);
        row.state = `Passed verification (run ${success.id}); publishing`;
        continue;
      } catch (error) {
        // A pass that no longer satisfies the policy (for example after an
        // incompatible packager release) counts as a failure and is retried.
        failures.push({ ...success, policyError: error.message });
      }
    }
    failures.push(...mine.filter(run => run.status === 'completed' && run.conclusion !== 'success'));
    const lastFailure = failures[0] || null;
    let lastFailedStep = lastFailure?.policyError ? `approval policy: ${lastFailure.policyError}` : null;
    let lastFailureDetail = lastFailedStep;
    if (lastFailure && !lastFailure.policyError) {
      try {
        const { report } = await runEvidence(lastFailure.id);
        lastFailedStep = report.failedStep || 'unknown';
        lastFailureDetail = [lastFailedStep, report.failedMessage, report.failedSignature && `observed signer ${report.failedSignature}`].filter(Boolean).join('; ');
      } catch { lastFailedStep = 'no evidence'; lastFailureDetail = lastFailedStep; }
    }
    const failuresSinceChange = failures.filter(run => Date.parse(run.created_at) > verifierChangedAt).length;
    const failuresToday = failures.filter(run => now.getTime() - Date.parse(run.created_at) < 86_400_000).length;
    if (failuresSinceChange >= MAX_FAILURES_PER_VERIFIER || failuresToday >= MAX_FAILURES_PER_DAY) {
      const count = Math.max(failuresSinceChange, failuresToday);
      row.state = `Stopped after ${count} failures (${lastFailureDetail})`;
      alerts.push(`${app.name} ${candidate.version} failed verification ${count} times; retries resume after a curated verifier or definition change. Last failure: ${lastFailureDetail} (https://github.com/${QA}/actions/runs/${lastFailure.id})`);
      continue;
    }
    if (lastFailure && now.getTime() - Date.parse(lastFailure.updated_at) < RETRY_COOLDOWN_MS) { row.state = `Retry after cooldown (last step: ${lastFailedStep})`; continue; }

    // Prefer the last approved release for the upgrade test. Chrome's mutable
    // URL cannot serve an older build, so it falls through to the exemption.
    let previous = latest && latest.candidate.installerUrl !== candidate.installerUrl ? latest.candidate : null;
    if (!previous && !latest) {
      try { previous = await discoverPreviousCandidate(app, candidate); } catch { previous = null; }
    }
    // A vendor-managed app falls back to an untested upgrade when the earlier
    // installer itself could not be downloaded or inspected.
    if (previous && app.autoUpdate === 'vendor-managed' && /:previous$/.test(lastFailedStep || '')) previous = null;
    if (!previous && app.autoUpdate !== 'vendor-managed') {
      row.state = 'No earlier official installer for the upgrade test';
      alerts.push(`${app.name} ${candidate.version}: no earlier official installer is available, and this app requires a tested upgrade.`);
      continue;
    }
    await dispatchVerification({ app_label: `${app.name} ${candidate.version} ${app.architecture} [${candidate.id}]`, candidate: JSON.stringify(candidate), previous: previous ? JSON.stringify(previous) : '' });
    row.state = previous ? `Priority verification queued (upgrade from ${previous.version})` : 'Priority verification queued (vendor-managed, no upgrade test)';
  }

  // Decide whether the catalog must be signed again.
  const hasReleases = payload.releases.length > 0;
  const expiresSoon = hasReleases && (!payload.expiresAt || Date.parse(payload.expiresAt) - now.getTime() < RENEW_BEFORE_MS);
  const withdraw = (process.env.CURATED_WITHDRAW_RELEASE_ID || '').trim();
  let publish = approvals.length > 0 || catalog.dropped.length > 0 || (hasReleases && !catalog.current) || expiresSoon || withdraw !== '';
  const open = await gh(['api', `repos/${WEBSITE}/pulls?head=${WEBSITE.split('/')[0]}:${BRANCH}&state=open`]) || [];
  if (open.length && publish && !withdraw) {
    // An automation PR that already carries these changes is still merging.
    const pending = await gh(['api', '-H', 'Accept: application/vnd.github.raw+json', `repos/${WEBSITE}/contents/${CATALOG_PATH}?ref=${BRANCH}`], { optional: true });
    try {
      const pendingPayload = verifyCatalog(pending, CURATED_APPS, await trustedKeys(), now);
      const ids = new Set(pendingPayload.releases.map(release => release.id));
      const wanted = [...payload.releases.map(release => release.id)];
      for (const runId of approvals) {
        const run = runs.find(item => item.id === runId);
        const candidate = discovery.results.find(item => item.state === 'candidate' && item.candidate.id === run?.candidateId)?.candidate;
        if (candidate) wanted.push(releaseIdFor(candidate));
      }
      if (wanted.every(id => ids.has(id)) && catalog.dropped.every(id => !ids.has(id)) && Date.parse(pendingPayload.expiresAt) - now.getTime() >= RENEW_BEFORE_MS) publish = false;
    } catch { /* the pending PR is outdated; publish replaces it */ }
    if (Date.now() - Date.parse(open[0].created_at) > STALE_PR_MS) alerts.push(`Catalog publication PR #${open[0].number} has not merged after three hours: ${open[0].html_url}`);
  }
  if (hasReleases && payload.expiresAt && Date.parse(payload.expiresAt) - now.getTime() < 2 * 86_400_000) {
    alerts.push(`The signed catalog on main expires at ${payload.expiresAt}; automatic renewal has not merged yet.`);
  }

  // Every completed run, pass or fail, is kept in Supabase beyond artifact retention.
  if (supabaseConfigured() && process.env.CURATED_DRY_RUN !== 'true') {
    try { console.log(`Recorded ${await syncHistory(allRuns, runEvidence, { apps: CURATED_APPS, buildCuratedCartItem })} curated QA run(s) in Supabase.`); }
    catch (error) { alerts.push(`Curated QA history could not be recorded: ${error.message}`); }
  }

  await writeFile(resolve(root, 'plan.json'), `${JSON.stringify({ generatedAt: now.toISOString(), approvals, publish, rows, alerts }, null, 2)}\n`);
  await setOutput('publish', publish ? 'true' : 'false');
  await setOutput('approvals', JSON.stringify(approvals));
  const approvedCount = catalogEntries(CURATED_APPS, payload).filter(entry => entry.status === 'approved').length;
  await appendSummary([`### Curated catalog automation`, '', `${approvedCount}/${CURATED_APPS.length} applications deployable. Catalog expires: ${payload.expiresAt || 'not signed yet'}.`, '',
    summaryTable(rows), '', configStates.length ? ['**Custom PSADT configurations**', ...configStates.map(state => `- ${state}`), ''].join('\n') : '', alerts.length ? ['**Alerts**', ...alerts.map(alert => `- ${alert}`)].join('\n') : 'No alerts.', '',
    publish ? 'A signed catalog will be published in this run.' : 'No catalog change to publish.'].join('\n'));
  if (process.env.CURATED_SYNC_ISSUE === 'true') await syncAlertIssue(alerts, runUrl);
}

async function publish() {
  const now = new Date();
  const approvedAt = now.toISOString();
  const keys = await trustedKeys();
  const catalog = await loadCatalog(await readJson(CATALOG_PATH), now);
  const releases = [...catalog.payload.releases];
  const withdrawnReleaseIds = [...catalog.payload.withdrawnReleaseIds];
  const evidenceFiles = [];
  for (const runId of JSON.parse(process.env.CURATED_APPROVALS || '[]')) {
    const { app, release, evidence } = await approvedRelease(runId, approvedAt);
    if (releases.some(item => item.id === release.id || (item.candidate.appId === app.id && compareReleaseVersions(item.candidate.version, release.candidate.version) === 0))) continue;
    releases.push(release);
    evidenceFiles.push([`catalog/curated/evidence/${app.id}/${release.candidate.id}.json`, evidence]);
  }
  const withdraw = (process.env.CURATED_WITHDRAW_RELEASE_ID || '').trim();
  if (withdraw) {
    if (!releases.some(release => release.id === withdraw)) throw new Error('Choose an existing release ID to withdraw.');
    if ((process.env.CURATED_WITHDRAW_REASON || '').trim().length < 20) throw new Error('Explain the withdrawal in at least 20 characters.');
    if (!withdrawnReleaseIds.includes(withdraw)) withdrawnReleaseIds.push(withdraw);
  }
  if (!releases.length) { console.log('Nothing to sign.'); return; }

  const privateKey = process.env.CURATED_CATALOG_SIGNING_KEY;
  if (!privateKey) throw new Error('The environment signing key is unavailable.');
  const keyId = Object.keys(await readJson(KEYS_PATH)).at(-1);
  if (!keyId) throw new Error('No committed public trust key is installed.');
  const envelope = signCatalog({ schemaVersion: 1, generatedAt: approvedAt, expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    definitionsSha256: sha256(canonicalJson(CURATED_APPS)), releases, withdrawnReleaseIds }, CURATED_APPS, keyId, privateKey);
  const payload = verifyCatalog(envelope, CURATED_APPS, keys);
  for (const entry of catalogEntries(CURATED_APPS, payload)) if (entry.release) assertCuratedPackageProfile(entry.app, entry.release);

  await writeFile(CATALOG_PATH, `${JSON.stringify(envelope, null, 2)}\n`);
  for (const [path, value] of evidenceFiles) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  const added = evidenceFiles.map(([, evidence]) => `${appById(evidence.candidate.appId).name} ${evidence.candidate.version}`);
  const title = added.length ? `Publish verified curated releases: ${added.join(', ')}` : withdraw ? 'Withdraw a curated release' : 'Renew the signed curated catalog';
  const details = [
    added.length ? `Adds ${added.join(', ')}. Each release passed the isolated VM lifecycle test (install, ${evidenceFiles.some(([, e]) => e.previous) ? 'upgrade, ' : ''}detection, uninstall and removal), a publisher signature check and a clean Defender scan of the exact installer hash.` : '',
    withdraw ? `Withdraws \`${withdraw}\`: ${process.env.CURATED_WITHDRAW_REASON.trim()}` : '',
    catalog.dropped.length ? `Drops ${catalog.dropped.length} release(s) that no longer match the current definitions or packaging profile; they are verified again automatically.` : '',
    `Signed catalog valid until ${envelope.payload.expiresAt}.`,
    '', 'Opened and merged by the curated catalog automation. No manual review is required; CI validates the signature and definitions.',
  ].filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== '')).join('\n');

  const git = (...args) => {
    const result = spawnSync('git', args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${(result.stderr || '').split('\n')[0]}`);
    return result.stdout.trim();
  };
  const user = await gh(['api', 'user']);
  git('config', 'user.name', user.login);
  git('config', 'user.email', `${user.id}+${user.login}@users.noreply.github.com`);
  git('checkout', '-B', BRANCH);
  git('add', CATALOG_PATH, ...evidenceFiles.map(([path]) => path));
  git('commit', '-m', `${title}\n\n${details}`);
  const basic = Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString('base64');
  git('-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`, 'push', '--force', `https://github.com/${WEBSITE}.git`, `HEAD:refs/heads/${BRANCH}`);
  let pr = (await gh(['api', `repos/${WEBSITE}/pulls?head=${WEBSITE.split('/')[0]}:${BRANCH}&state=open`]) || [])[0];
  if (pr) await gh(['api', '-X', 'PATCH', `repos/${WEBSITE}/pulls/${pr.number}`, '--input', '-'], { input: JSON.stringify({ title, body: details }) });
  else pr = await gh(['api', '-X', 'POST', `repos/${WEBSITE}/pulls`, '--input', '-'], { input: JSON.stringify({ title, body: details, head: BRANCH, base: 'main' }) });
  // Auto-merge waits for the required checks, then squash-merges.
  const merge = spawnSync('gh', ['pr', 'merge', String(pr.number), '--repo', WEBSITE, '--squash', '--auto'], { encoding: 'utf8' });
  if (merge.status !== 0 && !/already/i.test(merge.stderr || '')) throw new Error('Enabling auto-merge failed.');
  await appendSummary(`Published ${title} as ${pr.html_url}.`);
}

try {
  if (mode === 'plan') await plan(); else await publish();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
