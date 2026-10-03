#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { validateDefinitions, verifyCatalog } from '../lib/curated-catalog/core.mjs';
import { curatedMonitor } from '../lib/curated-catalog/monitor.mjs';
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const apps = validateDefinitions(await readJson('lib/curated-catalog/definitions.json'));
let summary;
try {
  const payload = verifyCatalog(await readJson('catalog/curated/catalog.json'), apps, await readJson('catalog/curated/trusted-keys.json'));
  summary = curatedMonitor(apps, payload, await readJson('output/curated/discovery.json'));
} catch {
  summary = { approved: 0, alerts: ['Curated discovery or signed catalog validation failed; operator review is required'], pending: [] };
}
await writeFile('output/curated/monitor.json', `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
const markdown = [`${summary.approved}/${apps.length} applications approved.`, '', ...summary.alerts.map(alert => `- ALERT: ${alert}`), ...summary.pending.map(item => `- ${item}`), '', 'Discovery never approves, signs, downloads installers, or changes deployment availability.'].join('\n');
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, { flag: 'a' });
if (summary.alerts.length) process.exitCode = 1;
