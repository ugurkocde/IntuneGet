import { describe, expect, it } from 'vitest';
import { inventoryPageUrl, toInventoryListApp } from './inventory-list';
import type { IntuneWin32App } from '@/types/inventory';

describe('inventory list payload', () => {
  it('retains search/stat/card fields without sending icon or configuration payloads', () => {
    const app = { id: 'one', displayName: 'App', description: 'Find me', publisher: 'Publisher',
      size: 123, installExperience: { runAsAccount: 'system' },
      largeIcon: { value: 'x'.repeat(100_000) }, detectionRules: [{ scriptContent: 'private-script' }],
    } as unknown as IntuneWin32App;
    const result = toInventoryListApp(app);
    expect(result).toMatchObject({ id: 'one', description: 'Find me', size: 123, hasIcon: true });
    expect(result).not.toHaveProperty('largeIcon');
    expect(result).not.toHaveProperty('detectionRules');
    expect(JSON.stringify(result).length).toBeLessThan(400);
  });
  it('treats malicious-looking cursors as tokens, never destination URLs', () => {
    const cursor = 'https://attacker.invalid/?$filter=all&other=value';
    const url = new URL(inventoryPageUrl(cursor));
    expect(url.origin).toBe('https://graph.microsoft.com');
    expect(url.pathname).toBe('/beta/deviceAppManagement/mobileApps');
    expect(url.searchParams.get('$skiptoken')).toBe(cursor);
    expect(url.searchParams.get('$filter')).toBe("isof('microsoft.graph.win32LobApp')");
  });
});
