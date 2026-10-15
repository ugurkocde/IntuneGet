// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
vi.mock('./useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ getAccessToken: async () => 'synthetic-token' }) }));
import { useUpdatePolicy } from './use-updates';
it('sends scope changes through PATCH with no configuration or enable fields', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ policy: {} }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const node = document.createElement('div'); document.body.append(node);
  const root = createRoot(node);
  let hook: ReturnType<typeof useUpdatePolicy>;
  function Harness() { hook = useUpdatePolicy(); return null; }
  try {
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Harness))));
    await act(async () => { await hook.updatePolicy({ id: 'saved-policy', auto_update_scope: 'major' }); });
    expect(fetchMock).toHaveBeenCalledWith('/api/update-policies/saved-policy', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ auto_update_scope: 'major' }) }));
    await act(async () => { await hook.updatePolicy({ winget_id: 'Fixture.App', tenant_id: 'fixture-tenant', policy_type: 'notify' }); });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/update-policies', expect.objectContaining({ method: 'POST' }));
  } finally { await act(async () => root.unmount()); node.remove(); client.clear(); vi.unstubAllGlobals(); }
});
