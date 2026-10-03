#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, catalogEntries, createCandidate, sha256, signCatalog, validateDefinitions, validateRelease, verifyCatalog } from '../lib/curated-catalog/core.mjs';
import { discoverCandidate } from '../lib/curated-catalog/discovery.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args.shift();
const flags = {};
while (args.length) {
  const key = args.shift();
  if (!key.startsWith('--') || !args[0] || args[0].startsWith('--')) throw new Error(`Expected a value for ${key}.`);
  flags[key.slice(2)] = args.shift();
}
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const writeJson = async (path, value) => {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
};
const apps = validateDefinitions(await readJson('lib/curated-catalog/definitions.json'));
const trustedKeys = () => JSON.parse(process.env.CURATED_CATALOG_PUBLIC_KEYS || '{}');

try {
  switch (command) {
    case 'validate': {
      const catalog = await readJson(flags.catalog || 'catalog/curated/catalog.json');
      const payload = verifyCatalog(catalog, apps, trustedKeys());
      const entries = catalogEntries(apps, payload);
      console.log(`${apps.length} definitions; ${entries.filter(entry => entry.status === 'approved').length} approved apps; ${payload.releases.length} release records.`);
      break;
    }
    case 'discover': {
      const selected = flags.app ? apps.filter(app => app.id === flags.app) : apps;
      if (!selected.length) throw new Error('Unknown curated app.');
      const results = [];
      for (const app of selected) {
        try { results.push(await discoverCandidate(app)); }
        catch (error) { results.push({ appId: app.id, state: 'error', message: error.message }); }
        console.log(`${app.id}: ${results.at(-1).state}`);
      }
      const output = flags.output || `output/curated/discovery-${Date.now()}.json`;
      await writeJson(output, { generatedAt: new Date().toISOString(), definitionsSha256: sha256(canonicalJson(apps)), results });
      console.log(`Discovery metadata saved to ${output}. No installers downloaded; no releases approved.`);
      if (results.some(result => result.state === 'error')) process.exitCode = 1;
      break;
    }
    case 'candidate': {
      const app = apps.find(app => app.id === flags.app);
      if (!app) throw new Error('Choose a known --app.');
      const candidate = createCandidate(app, { version: flags.version, installerUrl: flags['installer-url'], vendorSha256: flags.sha256 || null, releaseNotesUrl: flags['release-notes'] || app.releaseSource });
      await writeJson(flags.output || `output/curated/${candidate.appId}-${candidate.id}.json`, candidate);
      console.log(`Recorded candidate ${candidate.id}; verification and approval are still required.`);
      break;
    }
    case 'profile': {
      if (!flags.candidate || !flags.sha256 || !flags.output || !flags.server) throw new Error('Provide --candidate, --sha256, --server, and a new --output.');
      const token = process.env.CURATED_CATALOG_OPERATOR_TOKEN;
      if (!token) throw new Error('Set CURATED_CATALOG_OPERATOR_TOKEN for the verification-profile endpoint.');
      const server = new URL(flags.server);
      if ((server.protocol !== 'https:' && !(server.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(server.hostname))) || server.username || server.password || server.search || server.hash) throw new Error('Choose an HTTPS server or a local development server.');
      const response = await fetch(new URL('/api/curated-catalog/verification-profile', server), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate: await readJson(flags.candidate), installerSha256: flags.sha256 }),
      });
      if (!response.ok) throw new Error(`Verification profile rejected (HTTP ${response.status}).`);
      await writeJson(flags.output, await response.json());
      console.log('Saved an isolated-test input. This does not approve a release or queue a deployment.');
      break;
    }
    case 'approve':
    case 'withdraw':
    case 'sign': {
      // These commands create a review artifact only. They never overwrite the
      // committed catalog, push a branch, deploy, or mutate the production DB.
      if (!flags.output) throw new Error('Choose a new --output file for the signed review artifact.');
      const catalog = await readJson(flags.catalog || 'catalog/curated/catalog.json');
      // Explicit signing can renew an expired catalog after checking its
      // signature at the last valid instant. Deployment never uses this path.
      const validationTime = command === 'sign' && catalog.payload?.expiresAt
        ? new Date(Math.min(Date.now(), Date.parse(catalog.payload.expiresAt) - 1)) : new Date();
      const payload = verifyCatalog(catalog, apps, trustedKeys(), validationTime);
      const releases = [...payload.releases]; const withdrawnReleaseIds = [...payload.withdrawnReleaseIds];
      if (command === 'approve') {
        if (!flags.release) throw new Error('Provide a fully verified --release JSON record.');
        const release = await readJson(flags.release);
        const app = apps.find(app => app.id === release.candidate?.appId);
        if (!app) throw new Error('Unknown curated release app.');
        validateRelease(app, release);
        if (releases.some(previous => previous.id === release.id || (previous.candidate.appId === app.id && previous.candidate.version === release.candidate.version))) throw new Error('This release or version already has an immutable approval record.');
        releases.push(release);
      }
      if (command === 'withdraw') {
        if (!releases.some(release => release.id === flags.release)) throw new Error('Provide an existing release ID with --release.');
        if (!withdrawnReleaseIds.includes(flags.release)) withdrawnReleaseIds.push(flags.release);
      }
      const privateKey = process.env.CURATED_CATALOG_SIGNING_KEY;
      if (!privateKey || !flags['key-id']) throw new Error('A protected CURATED_CATALOG_SIGNING_KEY and --key-id are required.');
      const now = new Date();
      const envelope = signCatalog({ schemaVersion: 1, generatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 7 * 86400_000).toISOString(), definitionsSha256: sha256(canonicalJson(apps)), releases, withdrawnReleaseIds }, apps, flags['key-id'], privateKey);
      // The signing key must also be installed in the verifier trust store.
      verifyCatalog(envelope, apps, trustedKeys());
      await writeJson(flags.output, envelope);
      console.log(`Signed ${command} artifact created. Review it before replacing catalog/curated/catalog.json.`);
      break;
    }
    default:
      console.log('Usage: node scripts/curated-catalog.mjs <validate|discover|candidate|profile|approve|withdraw|sign> [--app id] [--catalog path] [--output new-path]');
      process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
