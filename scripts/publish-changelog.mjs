import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://changelog.ugurlabs.com/api/changelog';
const entriesDirectory = '.ugurlabs/entries';
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

export function validateConfig(config) {
  if (config?.schemaVersion !== 1 || config.apiUrl !== API || config.productId !== 'intuneget' ||
      config.productName !== 'IntuneGet' || config.websiteUrl !== 'https://www.intuneget.com/') {
    throw new Error('Unexpected IntuneGet changelog configuration');
  }
  return config;
}

export function validateEntry(entry, filename) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(filename) || filename.length > 150 ||
      !entry || typeof entry !== 'object' || Array.isArray(entry) ||
      Object.keys(entry).some(key => !['title', 'summary', 'type', 'sourceUrl'].includes(key))) {
    throw new Error('Invalid changelog entry file');
  }
  for (const [key, min, max] of [['title', 3, 160], ['summary', 12, 2000]]) {
    if (typeof entry[key] !== 'string' || entry[key] !== entry[key].trim() || entry[key].length < min || entry[key].length > max) {
      throw new Error(`Invalid changelog ${key}`);
    }
  }
  if (!['new', 'improved', 'fixed', 'maintenance'].includes(entry.type)) throw new Error('Invalid change type');
  if (entry.sourceUrl !== undefined) {
    // Only public project links belong in this repository's publication queue.
    if (typeof entry.sourceUrl !== 'string' || entry.sourceUrl.length > 2000 ||
        !/^https:\/\/(?:github\.com\/ugurkocde\/IntuneGet\/(?:pull\/\d+|releases\/tag\/[\w.-]+)|www\.intuneget\.com\/[\w/-]*)$/.test(entry.sourceUrl)) {
      throw new Error('Invalid public source URL');
    }
  }
  return entry;
}

export function publicationPayload(config, entry, filename, commit, date) {
  validateConfig(config);
  validateEntry(entry, filename);
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid changelog source commit or date');
  }
  return { ...entry, publishedOn: date, sourceCommit: commit,
    idempotencyKey: `${config.productId}:entry:${filename.slice(0, -5)}` };
}

export async function apiRequest(method, url, token, body, fetchImpl = fetch) {
  if (url !== `${API}/intuneget` && url !== `${API}/intuneget?limit=100`) throw new Error('Unexpected API destination');
  const response = await fetchImpl(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' && token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (method === 'GET' && response.status === 404) return null;
  if (!response.ok) throw new Error(`Changelog API ${method} failed with HTTP ${response.status}`);
  return response.json();
}

export async function publishEntry(url, token, payload, request = apiRequest) {
  // A retry always retains the exact same product-scoped key and body.
  let result;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      result = await request('POST', url, token, payload);
      break;
    } catch (error) {
      if (attempt === 1 || /HTTP (?:400|401|403|404)/.test(error.message)) throw error;
    }
  }
  if (!result || typeof result.id !== 'string' || !result.id || typeof result.created !== 'boolean') {
    throw new Error('Unexpected publication result; inspect the public feed before retrying');
  }
  return result;
}

export async function main(validateOnly = false) {
  const config = validateConfig(JSON.parse(await readFile('.ugurlabs/changelog.json', 'utf8')));
  const files = (await readdir(entriesDirectory)).filter(file => file.endsWith('.json')).sort();
  const entries = await Promise.all(files.map(async filename => ({ filename,
    entry: validateEntry(JSON.parse(await readFile(`${entriesDirectory}/${filename}`, 'utf8')), filename) })));
  if (validateOnly) {
    console.log(`Validated ${entries.length} public changelog entries. No writes performed.`);
    return;
  }
  const token = process.env.CHANGELOG_PUBLISH_TOKEN;
  if (!token) throw new Error('Missing CHANGELOG_PUBLISH_TOKEN Actions secret');
  const url = `${config.apiUrl}/${config.productId}`;
  const feed = await apiRequest('GET', `${url}?limit=100`);
  if (feed && (feed.product?.id !== config.productId || feed.product?.name !== config.productName || feed.product?.websiteUrl !== config.websiteUrl)) {
    throw new Error('Existing product registration does not match this repository');
  }
  if (!feed) await apiRequest('PUT', url, token, { productName: config.productName, websiteUrl: config.websiteUrl });

  const createdIds = [];
  for (const { filename, entry } of entries) {
    // The entry's introducing commit is stable across subsequent CI runs.
    // Keep published files immutable, and add a new file for each later update.
    const history = execFileSync('git', ['log', '--diff-filter=A', '--format=%H%n%cs', '--', `${entriesDirectory}/${filename}`], { encoding: 'utf8' }).trim().split('\n');
    if (history.length !== 2) throw new Error(`Entry must have one introducing commit: ${filename}`);
    const result = await publishEntry(url, token, publicationPayload(config, entry, filename, ...history));
    console.log(`${result.created ? 'Published' : 'Already published'}: ${filename} (${result.id})`);
    if (result.created) createdIds.push(result.id);
  }
  // Verify new writes through the same public API used by the bell. Previously
  // published entries may eventually fall outside the latest 100 results.
  for (let attempt = 0; attempt < 35; attempt++) {
    const publicFeed = await apiRequest('GET', `${url}?limit=100`);
    if (publicFeed?.product?.id === config.productId && Array.isArray(publicFeed.entries) &&
        createdIds.every(id => publicFeed.entries.some(entry => entry.id === id))) {
      console.log(`Verified public IntuneGet feed (${createdIds.length} new entries).`);
      return;
    }
    if (attempt < 34) await delay(10_000);
  }
  throw new Error('Publication returned success, but the public feed could not be verified; rerun with unchanged entry files');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--validate')) throw new Error('Usage: publish-changelog.mjs [--validate]');
  main(args[0] === '--validate').catch(error => {
    // No response body, environment dump, or credential-bearing request details.
    console.error(error.message);
    process.exitCode = 1;
  });
}
