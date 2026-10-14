import { NextRequest, NextResponse } from 'next/server';
import { parseAccessToken } from '@/lib/auth-utils';
import { getDatabase, isSqliteMode } from '@/lib/db';
import { createServerClient, isSupabaseServerConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseCustomAppDefinition } from '@/lib/custom-app-definitions';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function scope(request: NextRequest) {
  const user = await parseAccessToken(request.headers.get('Authorization'));
  if (!user) return { error: reply({ error: 'Authentication required' }, 401) };
  const requestedTenantId = request.headers.get('X-MSP-Tenant-Id');
  if (isSqliteMode()) {
    if (requestedTenantId && requestedTenantId !== user.tenantId) return { error: reply({ error: 'This installation cannot access another tenant' }, 403) };
    return { userId: user.userId, tenantId: user.tenantId };
  }
  if (!isSupabaseServerConfigured()) return { error: reply({ error: 'Saved custom apps are unavailable' }, 503) };
  const resolved = await resolveTargetTenantId({ supabase: createServerClient(), userId: user.userId, tokenTenantId: user.tenantId, requestedTenantId });
  if (resolved.errorResponse) {
    resolved.errorResponse.headers.set('Cache-Control', 'no-store');
    return { error: resolved.errorResponse };
  }
  return { userId: user.userId, tenantId: resolved.tenantId };
}

/** Read a small JSON request without buffering an unbounded upload. */
async function readBody(request: NextRequest): Promise<unknown> {
  if (!request.body) throw new Error('INVALID_BODY');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      // Leave room for JSONB's spaces when it measures the normalized object.
      if (size > 16000) { await reader.cancel(); throw new Error('BODY_TOO_LARGE'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

export async function GET(request: NextRequest) {
  try {
    const owner = await scope(request);
    if (owner.error) return owner.error;
    const offsetText = request.nextUrl.searchParams.get('offset') ?? '0';
    if (!/^\d{1,5}$/.test(offsetText) || Number(offsetText) > 10000) return reply({ error: 'Invalid page' }, 400);
    const rows = await getDatabase().customAppDefinitions.list(owner.userId, owner.tenantId, 51, Number(offsetText));
    return reply({ definitions: rows.slice(0, 50), hasMore: rows.length > 50 });
  } catch { return reply({ error: 'Could not load saved custom apps' }, 500); }
}

export async function POST(request: NextRequest) {
  try {
    const owner = await scope(request);
    if (owner.error) return owner.error;
    let body: unknown;
    try { body = await readBody(request); }
    catch (error) { return reply({ error: 'Invalid custom app definition' }, error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Invalid custom app definition' }, 400);
    const record = body as Record<string, unknown>;
    if (Object.keys(record).some(key => key !== 'id' && key !== 'definition') || (record.id !== undefined && (typeof record.id !== 'string' || !uuid.test(record.id)))) return reply({ error: 'Invalid custom app definition' }, 400);
    let definition;
    try { definition = parseCustomAppDefinition(record.definition); }
    catch { return reply({ error: 'Invalid custom app definition' }, 400); }
    const saved = await getDatabase().customAppDefinitions.save(owner.userId, owner.tenantId, definition, record.id as string | undefined);
    return saved ? reply({ definition: saved }, record.id ? 200 : 201) : reply({ error: 'Saved custom app not found' }, 404);
  } catch { return reply({ error: 'Could not save custom app' }, 500); }
}

export async function DELETE(request: NextRequest) {
  try {
    const owner = await scope(request);
    if (owner.error) return owner.error;
    const id = request.nextUrl.searchParams.get('id');
    if (!id || !uuid.test(id)) return reply({ error: 'Invalid saved custom app ID' }, 400);
    return await getDatabase().customAppDefinitions.delete(owner.userId, owner.tenantId, id)
      ? reply({ deleted: true }) : reply({ error: 'Saved custom app not found' }, 404);
  } catch { return reply({ error: 'Could not delete saved custom app' }, 500); }
}
