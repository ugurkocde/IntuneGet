import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every route handler that changes something and can act in a customer tenant
 * of an MSP has to say which MSP permission it needs. The permission is the
 * `requiredPermission` argument of resolveTargetTenantId, which enforces the
 * caller's role whenever the target is not their own tenant.
 *
 * This test reads the route sources, so a new write route that resolves an
 * MSP tenant without naming a permission fails here instead of shipping with
 * the role check missing.
 */

const API_ROOT = join(process.cwd(), 'app/api');

/** Write handlers that deliberately need no permission, with the reason. */
const OPEN_WRITE_HANDLERS: Record<string, string> = {
  'app/api/updates/refresh/route.ts POST': 'Scans for available updates and stores the result. Changes nothing in Intune.',
  'app/api/auth/verify-consent/route.ts POST': 'Checks whether consent is in place and caches the answer.',
  'app/api/intune/unmanaged-apps/route.ts POST': 'Returns statistics. POST is used to carry the filter.',
  'app/api/curated-catalog/settings-verification/route.ts POST': 'Checks the deploy permission itself right after resolving the tenant.',
};

/**
 * Route files that resolve the MSP tenant in a shared helper above their
 * handlers. The scan below cannot attribute such a call to a handler, so each
 * file is listed with how its write handlers are covered.
 */
const REVIEWED_HELPER_FILES: Record<string, string> = {
  'app/api/custom-apps/route.ts': 'scope(request, permission): POST and DELETE pass deploy_apps (asserted below).',
  'app/api/curated-catalog/attestations/route.ts': 'resolveCaller(): POST checks deploy_apps itself for a customer tenant.',
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === 'route.ts' ? [path] : [];
  });
}

interface Handler {
  file: string;
  method: string;
  body: string;
}

function handlers(file: string): Handler[] {
  const source = readFileSync(file, 'utf8');
  const starts = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)];
  return starts.map((match, index) => ({
    file: relative(process.cwd(), file).replace(/\\/g, '/'),
    method: match[1],
    body: source.slice(match.index, starts[index + 1]?.index ?? source.length),
  }));
}

/** The argument text of each resolveTargetTenantId call in a piece of source. */
function resolveCalls(source: string): string[] {
  const calls: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf('resolveTargetTenantId(', from);
    if (start === -1) return calls;
    let depth = 0;
    let end = start + 'resolveTargetTenantId'.length;
    do {
      if (source[end] === '(') depth++;
      if (source[end] === ')') depth--;
      end++;
    } while (depth > 0 && end < source.length);
    calls.push(source.slice(start, end));
    from = end;
  }
}

const all = routeFiles(API_ROOT).flatMap(handlers);

describe('MSP role coverage of write routes', () => {
  it('finds the route handlers', () => {
    expect(all.length).toBeGreaterThan(100);
    expect(all.some((handler) => handler.file === 'app/api/package/route.ts' && handler.method === 'POST')).toBe(true);
  });

  it('names a permission wherever a write handler resolves an MSP tenant', () => {
    const missing = all
      .filter((handler) => handler.method !== 'GET')
      .filter((handler) => !OPEN_WRITE_HANDLERS[`${handler.file} ${handler.method}`])
      .filter((handler) => resolveCalls(handler.body).some((call) => !call.includes('requiredPermission')))
      .map((handler) => `${handler.file} ${handler.method}`);

    expect(missing).toEqual([]);
  });

  it.each([
    ['app/api/package/route.ts', 'POST', 'deploy_apps'],
    ['app/api/intune/claim/route.ts', 'POST', 'deploy_apps'],
    ['app/api/intune/claim/route.ts', 'PATCH', 'deploy_apps'],
    ['app/api/mappings/route.ts', 'POST', 'deploy_apps'],
    ['app/api/mappings/route.ts', 'DELETE', 'deploy_apps'],
    ['app/api/intune/esp-profiles/add-app/route.ts', 'POST', 'deploy_apps'],
    ['app/api/intune/apps/[id]/settings/route.ts', 'PATCH', 'deploy_apps'],
    ['app/api/updates/trigger/route.ts', 'POST', 'deploy_apps'],
    ['app/api/update-policies/route.ts', 'POST', 'manage_policies'],
    ['app/api/update-policies/[id]/route.ts', 'PATCH', 'manage_policies'],
  ])('%s %s requires %s', (file, method, permission) => {
    const handler = all.find((entry) => entry.file === file && entry.method === method);
    expect(handler, `${file} ${method} not found`).toBeDefined();
    const calls = resolveCalls(handler!.body);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain(`requiredPermission: '${permission}'`);
  });

  it('custom app writes pass the deploy permission to their shared tenant lookup', () => {
    const source = readFileSync(join(API_ROOT, 'custom-apps/route.ts'), 'utf8');
    const writes = handlers(join(API_ROOT, 'custom-apps/route.ts')).filter((handler) => handler.method !== 'GET');
    expect(writes.map((handler) => handler.method).sort()).toEqual(['DELETE', 'POST']);
    for (const handler of writes) expect(handler.body).toContain("scope(request, 'deploy_apps')");
    expect(source).toMatch(/resolveTargetTenantId\(\{[^}]*requiredPermission[^}]*\}\)/);
  });

  it('knows every route file that resolves the tenant in a shared helper', () => {
    const withHelper = routeFiles(API_ROOT)
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        const firstHandler = source.search(/export async function (GET|POST|PUT|PATCH|DELETE)\b/);
        return resolveCalls(firstHandler === -1 ? source : source.slice(0, firstHandler)).length > 0;
      })
      .map((file) => relative(process.cwd(), file).replace(/\\/g, '/'))
      .sort();

    expect(withHelper).toEqual(Object.keys(REVIEWED_HELPER_FILES).sort());
  });

  it('checks the deploy permission in the attestation write handler', () => {
    const post = all.find((entry) => entry.file === 'app/api/curated-catalog/attestations/route.ts' && entry.method === 'POST');
    expect(post?.body).toContain("hasPermission(membership.role as MspRole, 'deploy_apps')");
  });

  it('keeps the list of open handlers honest', () => {
    for (const key of Object.keys(OPEN_WRITE_HANDLERS)) {
      const [file, method] = key.split(' ');
      const handler = all.find((entry) => entry.file === file && entry.method === method);
      expect(handler, `${key} is listed as open but does not exist`).toBeDefined();
      expect(resolveCalls(handler!.body).length, `${key} no longer resolves an MSP tenant`).toBeGreaterThan(0);
    }
  });
});
