import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import UploadsPage from './page';

const fixture = vi.hoisted(() => ({ calls: 0, status: 'awaiting_qa', userId: 'fixture-owner', tenantId: 'fixture-tenant' }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual, useState(initial: unknown) {
    const call = fixture.calls++;
    if (call === 0) return [[{ id: 'fixture-job', user_id: fixture.userId, status: fixture.status, display_name: 'Example app', publisher: 'Example', winget_id: 'Example.App', version: '1', architecture: 'x64', installer_type: 'exe', progress_percent: 0, created_at: '2020-01-01T00:00:00.000Z', qa_requested_at: '2020-01-01T00:00:00.123456+00:00', updated_at: '2020-01-01T00:00:00Z' }], vi.fn()];
    if (call === 1) return [false, vi.fn()];
    if (call === 10) return [JSON.stringify(['mine', false, null, 'fixture-owner', 'fixture-tenant']), vi.fn()];
    return actual.useState(initial);
  } };
});
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ user: { id: 'fixture-owner', tenantId: 'fixture-tenant' }, getAccessToken: vi.fn() }) }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => ({ isMspUser: false, selectedTenantId: null }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => null }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('gt-next', () => ({ T: ({ children }: { children: ReactNode }) => children, Var: ({ children }: { children: ReactNode }) => children, useGT: () => (text: string) => text, useLocale: () => 'en' }));
beforeEach(() => { fixture.calls = 0; fixture.status = 'awaiting_qa'; fixture.userId = 'fixture-owner'; });
it('shows the real held job card options while retaining installation progress', () => {
  const html = renderToStaticMarkup(createElement(UploadsPage));
  expect(html).toContain('Installation validation was requested at least 72 hours ago.');
  expect(html).toContain('Custom installer help');
  expect(html).toContain('Support ID:');
  expect(html).toContain('Installation check');
});
it('removes the panel from the real card on terminal status or another owner', () => {
  fixture.status = 'deployed';
  expect(renderToStaticMarkup(createElement(UploadsPage))).not.toContain('Review your options');
  fixture.calls = 0; fixture.status = 'awaiting_qa'; fixture.userId = 'fixture-other';
  expect(renderToStaticMarkup(createElement(UploadsPage))).not.toContain('Review your options');
});
