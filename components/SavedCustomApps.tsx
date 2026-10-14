'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useMspOptional } from '@/hooks/useMspOptional';
import { Button } from '@/components/ui/button';
import type { CustomAppDefinition, SavedCustomAppDefinition } from '@/lib/custom-app-definitions';

interface Props {
  definition: () => CustomAppDefinition;
  onLoad: (definition: CustomAppDefinition) => void;
}

export function SavedCustomApps({ definition, onLoad }: Props) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { selectedTenantId } = useMspOptional();
  const [rows, setRows] = useState<SavedCustomAppDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);

  const call = useCallback(async (method: string, query = '', body?: unknown) => {
    const token = await getAccessToken();
    if (!token) throw new Error('Sign in to manage saved apps');
    const response = await fetch(`/api/custom-apps${query}`, { method, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error('Could not update saved custom apps');
    return response.json();
  }, [getAccessToken, selectedTenantId]);

  useEffect(() => {
    const current = ++generation.current;
    setRows([]); setSelectedId(undefined); setHasMore(false); setMessage(''); setBusy(false);
    if (isAuthenticated) {
      call('GET').then(data => { if (current === generation.current) { setRows(data.definitions); setHasMore(data.hasMore); } }).catch(() => { if (current === generation.current) setMessage('Could not load saved custom apps'); });
    }
    return () => { generation.current++; };
  }, [call, isAuthenticated]);

  const run = async (action: () => Promise<void>) => {
    const current = generation.current;
    setBusy(true); setMessage('');
    try { await action(); }
    catch (error) { if (current === generation.current) setMessage(error instanceof Error ? error.message : 'Could not update saved custom apps'); }
    finally { if (current === generation.current) setBusy(false); }
  };

  if (!isAuthenticated) return null;
  return <section className="rounded-lg border border-overlay/15 p-4 space-y-3" aria-label="Saved custom apps">
    <h3 className="font-medium text-text-primary">Saved custom apps</h3>
    <p className="text-sm text-text-muted">Save reusable details. Each new version needs a fresh version, installer URL and optional hash.</p>
    {rows.map(row => <div key={row.id} className="flex flex-wrap items-center gap-2">
      <span className="mr-auto text-sm">{row.definition.displayName}</span>
      <Button type="button" variant="outline" disabled={busy} onClick={() => { setSelectedId(row.id); onLoad(row.definition); setMessage('Enter the new version and installer URL before adding to the cart.'); }}>Deploy new version</Button>
      <Button type="button" variant="outline" disabled={busy} aria-label={`Delete ${row.definition.displayName}`} onClick={() => void run(async () => {
        const current = generation.current;
        await call('DELETE', `?id=${encodeURIComponent(row.id)}`);
        if (current !== generation.current) return;
        setRows(prev => prev.filter(item => item.id !== row.id));
        if (selectedId === row.id) setSelectedId(undefined);
      })}>Delete</Button>
    </div>)}
    {hasMore && <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => {
      const current = generation.current;
      const data = await call('GET', `?offset=${rows.length}`);
      if (current !== generation.current) return;
      setRows(prev => [...prev, ...data.definitions]); setHasMore(data.hasMore);
    })}>Load more saved apps</Button>}
    <div className="flex gap-2">
      <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => {
        const current = generation.current;
        let details: CustomAppDefinition;
        try { details = definition(); }
        catch { throw new Error('Fill in the app name, publisher and installer details before saving.'); }
        const data = await call('POST', '', { ...(selectedId ? { id: selectedId } : {}), definition: details });
        if (current !== generation.current) return;
        setSelectedId(data.definition.id);
        setRows(prev => [data.definition, ...prev.filter(item => item.id !== data.definition.id)]);
        setMessage('Definition saved. Nothing has been deployed.');
      })}>{selectedId ? 'Update saved definition' : 'Save definition'}</Button>
      {selectedId && <Button type="button" variant="outline" disabled={busy} onClick={() => setSelectedId(undefined)}>Save as a new app</Button>}
    </div>
    {message && <p role="status" className="text-sm text-text-muted">{message}</p>}
  </section>;
}
