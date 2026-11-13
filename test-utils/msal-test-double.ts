import { BrowserAuthError, BrowserAuthErrorCodes, InteractionStatus, type AccountInfo } from '@azure/msal-browser';
import { vi } from 'vitest';

export const cachedAccount: AccountInfo = {
  homeAccountId: 'home-a', localAccountId: 'user-a', tenantId: 'tenant-a',
  environment: 'example.test', username: 'a@example.test', name: 'A',
};

/** Account storage stays inaccessible until the asynchronous initialize call finishes. */
export function createMsalTestDouble(options: {
  cachedAccounts?: AccountInfo[];
  activeAccount?: () => AccountInfo | null;
} = {}) {
  const storedAccounts = options.cachedAccounts ?? [cachedAccount];
  const context: { accounts: AccountInfo[]; inProgress: InteractionStatus } = { accounts: [], inProgress: InteractionStatus.Startup };
  let initialized = false;
  let releaseInitialization!: () => void;
  const initializationGate = new Promise<void>(resolve => { releaseInitialization = resolve; });
  let selected: AccountInfo | null | undefined;
  function requireInitialized() {
    if (!initialized) throw new BrowserAuthError(BrowserAuthErrorCodes.uninitializedPublicClientApplication, 'Account APIs require initialize() to finish.');
  }
  const instance = {
    initialize: vi.fn(async () => {
      await initializationGate;
      initialized = true;
      context.accounts = storedAccounts;
      context.inProgress = InteractionStatus.None;
    }),
    getActiveAccount: vi.fn(() => {
      requireInitialized();
      return selected !== undefined ? selected : options.activeAccount ? options.activeAccount() : storedAccounts[0] ?? null;
    }),
    getAllAccounts: vi.fn(() => { requireInitialized(); return [...storedAccounts]; }),
    setActiveAccount: vi.fn((account: AccountInfo | null) => { requireInitialized(); selected = account; }),
    acquireTokenSilent: vi.fn(async () => ({ accessToken: 'fixture-token', expiresOn: new Date(Date.now() + 3600000) })),
    logoutRedirect: vi.fn(async () => {}),
    addEventCallback: vi.fn(() => 'fixture-event'),
    removeEventCallback: vi.fn(),
  };
  return { instance, context: Object.assign(context, { instance }), finishInitialization: releaseInitialization };
}
