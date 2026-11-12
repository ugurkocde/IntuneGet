import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppDetailPage from './page';

const source = vi.hoisted(() => ({
  getAppByWingetId: vi.fn(),
  getQaResult: vi.fn(),
  getInstallationChangelog: vi.fn(),
  getVersionInstallerInfo: vi.fn(),
  getPopularApps: vi.fn(),
}));

vi.mock('@/lib/catalog', () => ({ getCatalogSource: () => source }));
vi.mock('gt-next', () => ({
  T: ({ children }: { children: ReactNode }) => children,
  Var: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('Unexpected not found'); },
  permanentRedirect: () => { throw new Error('Unexpected redirect'); },
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    React.createElement('a', { href }, children),
}));
vi.mock('@/components/landing/Header', () => ({ Header: () => null }));
vi.mock('@/components/landing/sections/Footer', () => ({ Footer: () => null }));
vi.mock('@/components/AppIcon', () => ({ AppIcon: () => null }));
vi.mock('@/components/catalog/CatalogAppCard', () => ({ CatalogAppCard: () => null }));
vi.mock('@/components/catalog/CatalogCta', () => ({ CatalogCta: () => null }));
vi.mock('@/components/qa/QaReportButton', () => ({ QaReportButton: () => null }));

beforeEach(() => {
  vi.resetAllMocks();
  source.getInstallationChangelog.mockResolvedValue(null);
  source.getPopularApps.mockResolvedValue({ data: [], total: 0 });
  source.getVersionInstallerInfo.mockResolvedValue({
    installer_type: 'msi', silent_args: '/quiet', installer_scope: 'machine',
  });
});

async function renderPage(wingetId: string) {
  source.getAppByWingetId.mockResolvedValue({
    app: { winget_id: wingetId, name: 'Fixture app', publisher: 'Fixture publisher',
      latest_version: '1.0', description: 'Fixture description', category: 'utilities',
      app_source: 'win32', is_verified: true, is_locale_variant: false },
    versions: ['1.0'],
  });
  return renderToStaticMarkup(await AppDetailPage({ params: Promise.resolve({ wingetId }) }));
}

describe('catalog QA result availability', () => {
  it('shows a rejected lookup as unavailable rather than claiming no QA run', async () => {
    source.getQaResult.mockRejectedValue(new Error('PRIVATE_QA_FAILURE_SENTINEL'));
    const html = await renderPage('Fixture.Unavailable');
    expect(html).toContain('QA results are temporarily unavailable.');
    expect(html).toContain('Values come from the WinGet community manifest.');
    expect(html).not.toContain('has not completed an IntuneGet QA run');
    expect(html).not.toContain('PRIVATE_QA_FAILURE_SENTINEL');
    expect(html).not.toContain('Tested by IntuneGet QA');
    expect(source.getQaResult).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing copy for a successful empty lookup', async () => {
    source.getQaResult.mockResolvedValue(null);
    const html = await renderPage('Fixture.Missing');
    expect(html).toContain('This app has not completed an IntuneGet QA run yet.');
    expect(html).not.toContain('QA results are temporarily unavailable.');
  });

  it('keeps verified commands and QA presentation for a passed result', async () => {
    source.getQaResult.mockResolvedValue({
      outcome: 'Passed', tested_version: '1.0', tested_at_utc: '2026-01-01T00:00:00Z',
      installer_type: 'msi', install_command: 'QA_INSTALL_SENTINEL',
      uninstall_command: 'QA_UNINSTALL_SENTINEL',
      effective_configuration: { vendorSilentArguments: '/qa-quiet' },
    });
    const html = await renderPage('Fixture.Passed');
    expect(html).toContain('Commands and arguments were captured during an automated QA install of version');
    expect(html).toContain('QA_INSTALL_SENTINEL');
    expect(html).toContain('QA_UNINSTALL_SENTINEL');
    expect(html).not.toContain('has not completed an IntuneGet QA run');
    expect(html).not.toContain('QA results are temporarily unavailable.');
  });
});
