// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
vi.mock('gt-next', () => ({ T: ({ children }: { children: ReactNode }) => children, Var: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ isAuthenticated: true, getAccessToken: async () => 'test-token' }) }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => ({ isMspUser: true, selectedTenantId: 'customer-tenant' }) }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }));
import { CuratedCatalog } from './CuratedCatalog';
import { useCartStore } from '@/stores/cart-store';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';
import { buildCuratedCartItem } from '@/lib/curated-catalog/package';
import { releaseFixture } from '@/lib/curated-catalog/test-fixtures';

const acrobat = CURATED_APPS.find(app => app.id === 'acrobat-reader')!;
const attestation = acrobat.licenceAttestation!;
const release = releaseFixture(acrobat);

let root: Root | undefined;
let client: QueryClient | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); };
const button = (label: string) => [...document.querySelectorAll('button')].find(entry => entry.textContent?.includes(label)) as HTMLButtonElement;

describe('curated catalog licence attestation', () => {
  it('requires explicit acceptance for the selected tenant before adding the app to the cart', async () => {
    let accepted = false;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/curated-catalog') return Response.json({ generatedAt: null, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), entries: [{
        app: { id: acrobat.id, name: acrobat.name, publisher: acrobat.publisher, channel: acrobat.channel, category: acrobat.category,
          homepage: acrobat.homepage, architecture: acrobat.architecture, scope: acrobat.scope, locale: acrobat.locale,
          autoUpdate: acrobat.autoUpdate, licenceAttestation: attestation },
        status: 'approved',
        release: { id: release.id, version: release.candidate.version, approvedAt: release.approvedAt, installerSha256: release.installerSha256,
          sourceUrl: release.candidate.installerUrl, testedAt: release.evidence.qa.testedAt, testReportUrl: release.evidence.qa.reportUrl,
          securityReportUrl: release.evidence.security.reportUrl, signatureStatus: 'valid' },
        cartItem: buildCuratedCartItem(acrobat, release),
      }] });
      if (url === '/api/curated-catalog/attestations' && init?.method === 'POST') {
        accepted = true;
        return Response.json({ appId: acrobat.id, attestation, accepted: true, acceptedAt: '2026-10-04T10:00:00.000Z', acceptedByEmail: 'admin@contoso.test' });
      }
      if (url === '/api/curated-catalog/attestations') return Response.json({ attestations: [{ appId: acrobat.id, attestation, accepted,
        acceptedAt: accepted ? '2026-10-04T10:00:00.000Z' : null, acceptedByEmail: accepted ? 'admin@contoso.test' : null }] });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    useCartStore.setState({ items: [] });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
    await act(async () => { root!.render(createElement(QueryClientProvider, { client: client! }, createElement(CuratedCatalog))); });
    await settle();

    const link = [...document.querySelectorAll('a')].find(entry => entry.textContent?.includes(attestation.title))!;
    expect(link.getAttribute('href')).toBe(attestation.url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(button('Add to cart').disabled).toBe(true);
    expect(button('Accept agreement').disabled).toBe(true);

    const checkbox = document.querySelector<HTMLInputElement>(`#licence-${acrobat.id}`)!;
    await act(async () => { checkbox.click(); });
    expect(button('Accept agreement').disabled).toBe(false);
    await act(async () => { button('Accept agreement').click(); });
    await settle();

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ appId: acrobat.id, attestationId: attestation.id, attestationVersion: attestation.version, accepted: true });
    expect((post[1]!.headers as Record<string, string>)['X-MSP-Tenant-Id']).toBe('customer-tenant');
    expect(document.body.textContent).toContain('Accepted for this tenant');
    expect(button('Add to cart').disabled).toBe(false);
    await act(async () => { button('Add to cart').click(); });
    expect(useCartStore.getState().items).toHaveLength(1);
  });
});
