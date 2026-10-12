// Run against a local production server: node scripts/measure-bundles.mjs URL [output.json].
// BUILD_DIR may point at an isolated production build. Shared chunks count once
// per cold route, so do not sum routes or compare gzip estimates to CDN transfer.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2).filter(arg => arg !== '--check');
const base = new URL(args[0] || 'http://127.0.0.1:3000');
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Measure a local production server');
const routes = ['/', '/apps', '/docs', '/auth/signin', '/dashboard', '/dashboard/apps', '/dashboard/reports', '/dashboard/uploads', '/dashboard/unmanaged'];
const build = resolve(process.env.BUILD_DIR || '.next');
const results = {};
for (const route of routes) {
  const response = await fetch(new URL(route, base), { headers: { Cookie: 'msal-auth-hint=1' } });
  if (!response.ok || new URL(response.url).pathname !== route) throw new Error(`Cannot measure ${route}: ${response.status} ${response.url}`);
  const html = await response.text();
  const files = [...new Set([...html.matchAll(/<script\b([^>]*)>/g)].flatMap(([, attributes]) => {
    if (/\bnomodule\b/i.test(attributes)) return [];
    const src = attributes.match(/\bsrc="([^"]+)"/)?.[1];
    return src?.startsWith('/_next/static/') ? [decodeURIComponent(new URL(src, base).pathname.replace('/_next/', ''))] : [];
  }))];
  if (!files.length) throw new Error(`No initial scripts on ${route}`);
  const buffers = await Promise.all(files.map(file => readFile(resolve(build, file))));
  results[route] = { jsBytes: buffers.reduce((n, b) => n + b.length, 0), jsGzip: buffers.reduce((n, b) => n + gzipSync(b).length, 0), files };
}
const json = JSON.stringify(results, null, 2) + '\n';
if (args[1]) await writeFile(args[1], json);
console.log(json);

if (process.argv.includes('--check')) {
  const budgets = JSON.parse(await readFile(new URL('./performance-budgets.json', import.meta.url), 'utf8'));
  const failures = routes.filter(route => results[route].jsGzip > budgets[route]);
  if (failures.length) throw new Error(`Initial JavaScript gzip budget exceeded: ${failures.map(route => `${route} (${results[route].jsGzip} > ${budgets[route]} bytes)`).join(', ')}`);
  console.error('All route bundle budgets passed.');
}
