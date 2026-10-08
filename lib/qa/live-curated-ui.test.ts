import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('gt-next', () => ({ T: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children) }));
vi.mock('@/components/AppIcon', () => ({ AppIcon: () => null }));
vi.mock('@/components/qa/QaVmViewer', () => ({ QaVmViewer: ({ src, phaseLabel }: { src: string | null; phaseLabel: string }) =>
  createElement('div', { 'data-frame-url': src ?? '', 'aria-label': 'VM viewer' }, phaseLabel) }));
import { QaCuratedCurrent } from '@/app/(marketing)/qa/QaCuratedCurrent';
import { projectQaLiveCurated } from './live-curated';
import { buildQaLiveResponse } from './live';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';
const id = '11111111-1111-4111-8111-111111111111';
const time = '2026-10-08T18:00:00.000Z';
const app = CURATED_APPS[0];
function response(isPrivate = false, phase = 'testing_lifecycle', heartbeat = time) {
  const data = buildQaLiveResponse({ now: new Date(time), current: null, queuedCount: 24, queued: [], poll: null, consecutivePollFailures: 0, recent: [], apps: [], frame: null });
  const projected = projectQaLiveCurated({ now: new Date(time), binding: { id, app_id: app.id, version: '1.0', kind: isPrivate ? 'config' : 'release', status: 'dispatched', inputs: {}, dispatched_at: time, github_run_id: '123' },
    session: { id, queue_id: id, app_id: app.id, version: '1.0', architecture: app.architecture, verification: 'release', public_frames: true,
      upgrade_planned: false, github_run_id: 123, state: 'active', phase, phase_started_at: time, started_at: time, heartbeat_at: heartbeat },
    frame: { session_id: id, sequence: 1, captured_at: time, updated_at: time, width: 640, height: 480 } })!;
  return { ...data, active: true, ...projected };
}
describe('curated current card', () => {
  it('renders safe catalogue identity, measured elapsed time and the curated frame URL', () => {
    const html = renderToStaticMarkup(createElement(QaCuratedCurrent, { data: response(), elapsed: '10:00' }));
    expect(html).toContain(app.name); expect(html).toContain('Catalog verification'); expect(html).toContain('10:00');
    expect(html).toContain('Testing package lifecycle');
    expect(html).toContain(`/api/qa/live/session/frame?session=${id}&amp;sequence=1`);
    expect(html).not.toContain('Preparing next test');
  });
  it('never mounts a frame viewer for a custom settings run', () => {
    const html = renderToStaticMarkup(createElement(QaCuratedCurrent, { data: response(true), elapsed: '10:00' }));
    expect(html).toContain('Custom settings'); expect(html).toContain('hidden to protect custom settings');
    expect(html).not.toContain('data-frame-url'); expect(html).not.toContain('/api/qa/live/session/frame');
  });
  it('names the viewer region for assistive technology and stops the spinner when stalled', () => {
    const live = renderToStaticMarkup(createElement(QaCuratedCurrent, { data: response(), elapsed: '10:00' }));
    expect(live).toContain('role="group" aria-label="Live catalog verification VM"'); expect(live).toContain('animate-spin');
    const stalled = response(); stalled.runner = { ...stalled.runner, state: 'stalled' };
    const html = renderToStaticMarkup(createElement(QaCuratedCurrent, { data: stalled, elapsed: '10:00' }));
    expect(html).toContain('Waiting for updates'); expect(html).not.toContain('animate-spin');
  });
  it('does not invent a lifecycle phase from an unknown value', () => {
    const html = renderToStaticMarkup(createElement(QaCuratedCurrent, { data: response(false, 'result-passed'), elapsed: '10:00' }));
    expect(html).toContain('Waiting for lifecycle progress'); expect(html).not.toContain('result-passed');
  });
});
