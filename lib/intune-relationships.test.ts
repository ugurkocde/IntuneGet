import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeRelationshipUpdate, syncAppRelationships, validateRelationships } from './intune-relationships';
const app = '11111111-1111-4111-8111-111111111111';
const target = '22222222-2222-4222-8222-222222222222';
const portal = '33333333-3333-4333-8333-333333333333';
const wanted = { relationshipType: 'dependency' as const, targetId: target, targetDisplayName: 'Untrusted label', dependencyType: 'autoInstall' as const };
const edge = { '@odata.type': '#microsoft.graph.mobileAppDependency', targetId: target, targetType: 'child', dependencyType: 'autoInstall', id: 'saved-id' };
afterEach(() => vi.unstubAllGlobals());
describe('same-app relationship updates', () => {
  it('preserves portal and auto-supersedence edges and excludes parent edges', () => {
    const automatic = { '@odata.type': '#microsoft.graph.mobileAppSupersedence', targetId: portal, targetType: 'child', supersedenceType: 'update' };
    const parent = { ...edge, targetId: app, targetType: 'parent' };
    expect(computeRelationshipUpdate([edge, automatic, parent], [wanted], [])).toEqual([
      { '@odata.type': automatic['@odata.type'], targetId: portal, supersedenceType: 'update' },
    ]);
  });
  it('changes only a managed subtype and retains its relationship identity', () => {
    const actual = computeRelationshipUpdate([edge], [wanted], [{ ...wanted, dependencyType: 'detect' }]);
    expect(actual).toEqual([{ '@odata.type': edge['@odata.type'], targetId: target, dependencyType: 'detect', id: 'saved-id' }]);
  });
  it('refuses stale baselines and conflicting portal changes before replacement', () => {
    expect(() => computeRelationshipUpdate([], [wanted], [wanted])).toThrow();
    expect(() => computeRelationshipUpdate([{ ...edge, dependencyType: 'detect' }], [], [wanted])).toThrow();
  });
  it('reconciles a removal already applied by approval or an uncertain prior request', () => {
    expect(computeRelationshipUpdate([], [wanted], [])).toEqual([]);
  });
  it('reconciles a subtype change already applied before the local save', () => {
    const desired = { ...wanted, dependencyType: 'detect' as const };
    expect(computeRelationshipUpdate([{ ...edge, dependencyType: 'detect' }], [wanted], [desired])).toEqual([
      { '@odata.type': edge['@odata.type'], targetId: target, dependencyType: 'detect', id: 'saved-id' },
    ]);
  });
  it.each([[{ ...wanted, targetId: app }], [wanted, wanted], [{ ...wanted, dependencyType: 'invalid' }], [{ ...wanted, targetId: 'bad/id' }]].map(value => ({ value })))('rejects invalid relationships', ({ value }) => {
    expect(() => validateRelationships(value, app)).toThrow();
  });
  it('uses the full replace action, reads back and stores server labels', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id: target, displayName: 'Trusted label', displayVersion: '2' }))
      .mockResolvedValueOnce(Response.json({ value: [] })).mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ value: [edge] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await syncAppRelationships('fixture-token', app, [], [wanted])).toEqual([{ ...wanted, targetDisplayName: 'Trusted label', targetVersion: '2' }]);
    expect(fetcher.mock.calls.filter(c => c[1].method === 'POST')).toHaveLength(1);
    expect(fetcher.mock.calls[2][0]).toContain(`/${app}/updateRelationships`);
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ relationships: [{ '@odata.type': edge['@odata.type'], targetId: target, dependencyType: 'autoInstall' }] });
    expect(fetcher.mock.calls.some(c => c[1].method === 'DELETE')).toBe(false);
  });
  it('reads derived target metadata without selecting fields on the mobileApp base type', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/relationships')) return Response.json({ value: [edge] });
      if (parsed.searchParams.get('$select')?.split(',').includes('displayVersion')) {
        return Response.json({ error: { message: 'Could not find a property named displayVersion on type microsoft.graph.mobileApp' } }, { status: 400 });
      }
      return Response.json({ id: target, displayName: 'Trusted label', displayVersion: '2' });
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await syncAppRelationships('fixture-token', app, [wanted], [wanted])).toEqual([
      { ...wanted, targetDisplayName: 'Trusted label', targetVersion: '2' },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('reports approval pending without retry or persistence claims', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id: target }))
      .mockResolvedValueOnce(Response.json({ value: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 403, headers: { 'x-msft-approval-code': 'fixture-approval' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(syncAppRelationships('fixture-token', app, [], [wanted])).rejects.toMatchObject({ kind: 'approval_pending' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('rejects foreign-tenant targets with zero writes', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(syncAppRelationships('fixture-token', app, [], [wanted])).rejects.toMatchObject({ kind: 'invalid' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reports uncertain applied state when readback differs', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id: target }))
      .mockResolvedValueOnce(Response.json({ value: [] })).mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ value: [] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(syncAppRelationships('fixture-token', app, [], [wanted])).rejects.toMatchObject({ kind: 'readback_mismatch', mayHaveApplied: true });
  });
  it('catches the saved baseline up after approval without submitting another mutation', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ value: [] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await syncAppRelationships('fixture-token', app, [wanted], [])).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].method).toBeUndefined();
  });
});
