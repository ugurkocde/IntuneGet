// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
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

const auth = vi.hoisted(() => ({
  isAuthenticated: true,
  user: { id: 'user', tenantId: 'tenant' },
  getAccessToken: vi.fn().mockResolvedValue('test-token'),
  signIn: vi.fn(),
  requestAdminConsent: vi.fn(),
}));

vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => auth }));
vi.mock('@/hooks/useMspOptional', () => ({
  useMspOptional: () => ({ isMspUser: false, selectedTenantId: null }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/AdminConsentBanner', () => ({
  clearConsentPending: vi.fn(),
  isConsentPending: () => false,
}));
vi.mock('@/hooks/usePermissionStatus', () => ({
  usePermissionStatus: () => ({
    status: 'verified',
    error: null,
    errorMessage: null,
    isChecking: false,
    verify: vi.fn(),
    canDeploy: true,
  }),
}));
vi.mock('@/hooks/use-qa', () => ({
  useQaStatuses: () => ({ data: undefined }),
}));

import { UploadCart } from './UploadCart';
import { useCartStore } from '@/stores/cart-store';
import type { Win32CartItem } from '@/types/upload';

const cartItem: Win32CartItem = {
  appSource: 'win32',
  wingetId: 'Test.App',
  displayName: 'Test App',
  publisher: 'Test',
  version: '1.0.0',
  architecture: 'x64',
  installScope: 'machine',
  installerType: 'exe',
  installerUrl: 'https://example.com/setup.exe',
  installerSha256: 'A'.repeat(64),
  installCommand: 'setup.exe /S',
  uninstallCommand: 'uninstall.exe /S',
  detectionRules: [],
  psadtConfig: {} as Win32CartItem['psadtConfig'],
  id: 'item-1',
  addedAt: new Date().toISOString(),
};

let root: Root | undefined;
let client: QueryClient | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  useCartStore.setState({ isOpen: false, items: [] });
});

async function flush(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(label)
  ) as HTMLButtonElement | undefined;
}

describe('cart removed-version update and retry', () => {
  it('offers to update to the published version and resends it on retry', async () => {
    const packageBodies: Array<{ items: Array<{ version: string }> }> = [];
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/package') && init?.method === 'POST') {
        packageBodies.push(JSON.parse(String(init.body)));
        if (packageBodies.length === 1) {
          return Response.json({
            error: 'Installer validation blocked this deployment',
            message: 'WinGet no longer publishes Test.App 1.0.0. The current published version is 2.0.0.',
            code: 'MANIFEST_UNAVAILABLE',
            retryable: false,
            latestVersion: '2.0.0',
            package: { wingetId: 'Test.App', displayName: 'Test App', version: '1.0.0' },
          }, { status: 409 });
        }
        return Response.json({
          success: true,
          jobs: [{ id: 'job-1', winget_id: 'Test.App', display_name: 'Test App', status: 'packaging' }],
        });
      }
      if (url.includes('/api/intune/apps/deployed')) {
        return Response.json({ tenantDeployments: [] });
      }
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetchMock);

    useCartStore.setState({ isOpen: true, items: [cartItem] });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const node = document.createElement('div');
    document.body.append(node);
    root = createRoot(node);
    await act(async () => {
      root!.render(createElement(QueryClientProvider, { client: client! }, createElement(UploadCart)));
    });
    await flush();

    const deploy = findButton('Deploy to Intune');
    expect(deploy).toBeTruthy();
    await act(async () => {
      deploy!.click();
    });
    await flush();

    const update = findButton('Update to v2.0.0 and retry');
    expect(update).toBeTruthy();

    await act(async () => {
      update!.click();
    });
    await flush();

    expect(packageBodies).toHaveLength(2);
    expect(packageBodies[1].items[0].version).toBe('2.0.0');
    // The retry succeeded, so the cart is cleared as usual.
    expect(useCartStore.getState().items).toHaveLength(0);
  });
});
