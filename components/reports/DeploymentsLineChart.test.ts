import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ locale: 'en-US', data: [] as Array<{ displayDate: string }> }));
vi.mock('gt-next', () => ({ useLocale: () => fixture.locale }));
vi.mock('recharts', () => ({ LineChart: ({ data }: { data: typeof fixture.data }) => { fixture.data = data; return null; }, ResponsiveContainer: ({ children }: { children: ReactNode }) => children, Line: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null, Legend: () => null }));
import { DeploymentsLineChart } from './DeploymentsLineChart';
beforeEach(() => { fixture.locale = 'en-US'; fixture.data = []; vi.stubEnv('TZ', 'America/Los_Angeles'); });
afterEach(() => vi.unstubAllEnvs());
const render = () => renderToStaticMarkup(createElement(DeploymentsLineChart, { data: [{ date: '2026-11-12', completed: 2, failed: 0 }] }));
it('labels the bucket day correctly in UTC minus eight', () => {
 expect(new Date('2026-11-12T00:00:00Z').getDate()).toBe(11); render(); expect(fixture.data[0].displayDate).toBe('Nov 12');
});
it('formats the bucket day in the current locale', () => {
 fixture.locale = 'fr'; render(); expect(fixture.data[0].displayDate).toContain('12 nov');
});
