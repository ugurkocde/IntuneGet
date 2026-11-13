import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { CustomerWaitOptions } from './CustomerWaitOptions';
import { customerJobSnapshotKey, type CustomerJobScope } from '@/lib/customer-wait-options';
vi.mock('gt-next', () => ({ T: ({ children }: { children: ReactNode }) => children }));
const scope: CustomerJobScope = { viewScope: 'mine', isMspUser: false, selectedTenantId: null, userId: 'fixture-owner', userTenantId: 'fixture-tenant' };
const context = { scope, snapshotKey: customerJobSnapshotKey(scope), isLoading: false, error: null, sessionExpired: false };
const job = { status: 'awaiting_qa', user_id: 'fixture-owner', qa_requested_at: '2026-11-10T00:00:00Z', created_at: '2026-11-01T00:00:00Z' };
const render = (value = job) => renderToStaticMarkup(createElement(CustomerWaitOptions, { job: value, context, now: Date.parse('2026-11-13T00:00:00Z') }));
it('renders translated factual copy and existing keyboard navigation under the card heading', () => {
  const html = render();
  expect(html).toContain('<h4');
  expect(html).toContain('Installation validation was requested at least 72 hours ago.');
  expect(html.match(/href="[^"]+"/g)).toEqual(['href="/dashboard/apps"', 'href="/docs/packaging"', 'href="/docs/getting-started"']);
  expect(html).toContain('<ul');
  expect(html).not.toMatch(/<nav|<h[123][ >]|<button|<form|onclick|tabindex="-1"/i);
});
it('describes creation age truthfully and removes the whole panel for terminal jobs', () => {
  expect(render({ ...job, qa_requested_at: null } as typeof job)).toContain('This request was created at least 72 hours ago.');
  expect(render({ ...job, status: 'deployed' })).toBe('');
});
