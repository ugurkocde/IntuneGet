#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Only bounded metadata is accepted. The runtime comes from the protected
// website revision, never from an installer or an untrusted artifact.
const [runtimePath, candidatePath, sha256, outputPath] = process.argv.slice(2);
if (!runtimePath || !candidatePath || !sha256 || !outputPath) throw new Error('Provide runtime, candidate JSON, measured SHA256, and a new output path.');
const text = await readFile(candidatePath, 'utf8');
if (Buffer.byteLength(text) > 16_384) throw new Error('Candidate metadata is too large.');
const { createCuratedVerificationProfile } = await import(pathToFileURL(resolve(runtimePath)).href);
const profile = createCuratedVerificationProfile(JSON.parse(text), sha256);
await writeFile(outputPath, `${JSON.stringify(profile, null, 2)}\n`, { flag: 'wx' });
