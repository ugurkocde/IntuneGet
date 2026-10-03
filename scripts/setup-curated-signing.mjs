#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../catalog/curated/trusted-keys.json', import.meta.url));
const keys = JSON.parse(await readFile(path, 'utf8'));
if (Object.keys(keys).length && !process.argv.includes('--rotate')) throw new Error('A signing key is already initialized. Use an explicitly reviewed rotation.');
const result = spawnSync('gh', ['api', 'repos/ugurkocde/IntuneGet/environments/curated-catalog-approval'], { encoding: 'utf8' });
if (result.status !== 0) throw new Error('Cannot inspect the signing environment.');
const environment = JSON.parse(result.stdout);
if (environment.can_admins_bypass !== false || !environment.protection_rules.some(rule => rule.type === 'required_reviewers')) throw new Error('Configure required reviewers and disable administrator bypass before initializing a signing key.');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const keyId = `curated-${new Date().toISOString().slice(0, 10)}-${Date.now()}`;
// The private key goes directly into gh's stdin. It is never printed, written
// to disk, committed, installed in the server, or copied to the QA guest.
const stored = spawnSync('gh', ['secret', 'set', 'CURATED_CATALOG_SIGNING_KEY', '--repo', 'ugurkocde/IntuneGet', '--env', 'curated-catalog-approval'], {
  input: privateKey.export({ type: 'pkcs8', format: 'pem' }), encoding: 'utf8',
});
if (stored.status !== 0) throw new Error('Protected signing-key installation failed.');
keys[keyId] = publicKey.export({ type: 'spki', format: 'pem' }).toString();
await writeFile(path, `${JSON.stringify(keys, null, 2)}\n`);
console.log(`Installed protected signing key ${keyId}. Review and commit its public trust entry.`);
