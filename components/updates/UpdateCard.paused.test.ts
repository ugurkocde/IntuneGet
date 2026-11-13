// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { AvailableUpdate } from '@/types/update-policies';
vi.mock('gt-next', () => ({ T: ({ children }: { children: ReactNode }) => children, Var: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/AppIcon', () => ({ AppIcon: () => null }));
vi.mock('./UpdatePolicySelector', () => ({ UpdatePolicySelector: ({ paused, onPolicyChange }: { paused?: boolean; onPolicyChange: (type: 'auto_update') => Promise<void> }) => createElement('button', { onClick: () => onPolicyChange('auto_update') }, paused ? 'Resume' : 'Active selector') }));
vi.mock('framer-motion', () => ({ useReducedMotion: () => true, AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: { div: ({ children }: { children: ReactNode }) => createElement('div', null, children), span: ({ children }: { children: ReactNode }) => createElement('span', null, children) } }));
import { UpdateCard } from './UpdateCard';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
it('shows a paused policy and forwards the selector recovery action', async () => {
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  const update = { id: 'fixture-update', winget_id: 'Fixture.App', display_name: 'Fixture app', current_version: '1.0.0', latest_version: '1.0.1',
    detected_at: '2026-11-13T12:00:00Z', is_managed: true, has_prior_deployment: true,
    policy: { id: 'fixture-policy', policy_type: 'auto_update', is_enabled: false, consecutive_failures: 3 } } as AvailableUpdate;
  const change = vi.fn(async () => {});
  try {
    await act(async () => root.render(createElement(UpdateCard, { update, onPolicyChange: change, onTriggerUpdate: vi.fn(), onDismiss: vi.fn() })));
    expect(node.textContent).toContain('Paused');
    const resume = [...node.querySelectorAll('button')].find(b => b.textContent === 'Resume');
    expect(resume).toBeDefined();
    await act(async () => resume!.click());
    expect(change).toHaveBeenCalledWith(update, 'auto_update', undefined);
  } finally { await act(async () => root.unmount()); node.remove(); }
});
